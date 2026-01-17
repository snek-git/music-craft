<script lang="ts">
  import { onMount } from "svelte";

  interface Element {
    id: string;
    name: string;
    type: "genre" | "artist";
  }

  interface CanvasElement extends Element {
    x: number;
    y: number;
    instanceId: string;
  }

  interface User {
    id: string;
    spotifyId: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
  }

  interface SpotifyArtist {
    id: string;
    name: string;
    genres: string[];
    imageUrl?: string;
    popularity: number;
    spotifyUrl: string;
  }

  interface LoadingElement {
    instanceId: string;
    x: number;
    y: number;
    elementA: string;
    elementB: string;
  }

  interface NowPlaying {
    artistName: string;
    trackName: string;
    previewUrl: string;
    albumArt?: string;
  }

  let allElements: Element[] = $state([]);
  let canvas: CanvasElement[] = $state([]);
  let loadingCombinations: LoadingElement[] = $state([]);
  let result: any = $state(null);
  let resultPos = $state({ x: 0, y: 0 });

  let dragging: { el: CanvasElement | Element; isNew: boolean; offsetX: number; offsetY: number } | null = $state(null);
  let dragPos = $state({ x: 0, y: 0 });
  let nearTarget: CanvasElement | null = $state(null);
  let canvasEl: HTMLElement;
  let sidebarEl: HTMLElement;

  let genres = $derived(allElements.filter(e => e.type === "genre").sort((a, b) => a.name.localeCompare(b.name)));
  let artists = $derived(allElements.filter(e => e.type === "artist").sort((a, b) => a.name.localeCompare(b.name)));

  let newArtist = $state("");
  let addingArtist = $state(false);
  let pendingArtist: { input: string; validated: string } | null = $state(null);

  interface ArtistInfo {
    name: string;
    listeners: number;
    playcount?: number;
    bio?: string;
    tags?: string[];
    url?: string;
  }
  let selectedInfo: ArtistInfo | null = $state(null);
  let loadingInfo = $state(false);
  let dragMoved = $state(false);

  // Spotify auth state
  let user: User | null = $state(null);
  let showImportModal = $state(false);
  let topArtists: SpotifyArtist[] = $state([]);
  let loadingTopArtists = $state(false);
  let selectedArtists = $state<Set<string>>(new Set());
  let importingArtists = $state(false);

  // Audio preview state
  let nowPlaying: NowPlaying | null = $state(null);
  let isPlaying = $state(false);
  let audioEl: HTMLAudioElement;

  // Mobile menu state
  let sidebarOpen = $state(false);

  // First-time help tooltip
  let showHelp = $state(false);

  // Touch long press handling
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressTriggered = $state(false);

  // UI Sound effects
  let soundsMuted = $state(localStorage.getItem("soundsMuted") === "true");
  const sounds: Record<string, HTMLAudioElement> = {};

  function initSounds() {
    const soundFiles = ["pickup", "drop", "combine", "success", "fail"];
    for (const name of soundFiles) {
      sounds[name] = new Audio(`/sounds/${name}.mp3`);
      sounds[name].volume = 0.3;
    }
  }

  function playSound(name: string) {
    if (soundsMuted || !sounds[name]) return;
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  }

  function toggleMute() {
    soundsMuted = !soundsMuted;
    localStorage.setItem("soundsMuted", String(soundsMuted));
  }

  async function lookupArtist() {
    if (!newArtist.trim() || addingArtist) return;
    addingArtist = true;
    try {
      const res = await fetch(`/api/elements/lookup?name=${encodeURIComponent(newArtist.trim())}`);
      const data = await res.json();
      if (data.name) {
        pendingArtist = { input: newArtist.trim(), validated: data.name };
      } else {
        pendingArtist = { input: newArtist.trim(), validated: newArtist.trim() };
      }
    } finally {
      addingArtist = false;
    }
  }

  async function confirmArtist() {
    if (!pendingArtist) return;
    addingArtist = true;
    try {
      const res = await fetch("/api/elements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pendingArtist.validated, type: "artist" }),
      });
      const data = await res.json();
      if (data.id) {
        allElements = [...allElements, data];
      }
    } finally {
      addingArtist = false;
      pendingArtist = null;
      newArtist = "";
    }
  }

  function cancelArtist() {
    pendingArtist = null;
  }

  // Spotify auth functions
  const API_URL = "";

  async function checkAuth() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: "include",
      });
      const data = await res.json();
      user = data.user;
    } catch (error) {
      console.error("Failed to check auth:", error);
      user = null;
    }
  }

  async function logout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
    user = null;
  }

  async function openImportModal() {
    showImportModal = true;
    selectedArtists = new Set();
    loadingTopArtists = true;
    try {
      const res = await fetch(`${API_URL}/api/spotify/top-artists?time_range=medium_term&limit=50`, {
        credentials: "include",
      });
      const data = await res.json();
      topArtists = data.artists || [];
    } catch (error) {
      console.error("Failed to load top artists:", error);
      topArtists = [];
    } finally {
      loadingTopArtists = false;
    }
  }

  function toggleArtistSelection(artistId: string) {
    const newSelected = new Set(selectedArtists);
    if (newSelected.has(artistId)) {
      newSelected.delete(artistId);
    } else {
      newSelected.add(artistId);
    }
    selectedArtists = newSelected;
  }

  function selectAllArtists() {
    selectedArtists = new Set(topArtists.map(a => a.id));
  }

  function deselectAllArtists() {
    selectedArtists = new Set();
  }

  async function importSelectedArtists() {
    if (selectedArtists.size === 0) return;
    importingArtists = true;
    try {
      const res = await fetch(`${API_URL}/api/spotify/import`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ artistIds: Array.from(selectedArtists) }),
      });
      const data = await res.json();

      if (data.success) {
        // Refresh elements list
        const elementsRes = await fetch("/api/elements", { credentials: "include" });
        allElements = await elementsRes.json();

        showImportModal = false;
        selectedArtists = new Set();

        const artistCount = data.artists?.imported?.length || 0;
        const genreCount = data.genres?.imported?.length || 0;
        const parts = [];
        if (artistCount > 0) parts.push(`${artistCount} artist${artistCount !== 1 ? 's' : ''}`);
        if (genreCount > 0) parts.push(`${genreCount} genre${genreCount !== 1 ? 's' : ''}`);

        result = {
          imported: true,
          message: parts.length > 0 ? `Imported ${parts.join(' and ')}` : 'Nothing new to import'
        };
      }
    } catch (error) {
      console.error("Failed to import artists:", error);
    } finally {
      importingArtists = false;
    }
  }

  function closeImportModal() {
    showImportModal = false;
    selectedArtists = new Set();
  }

  onMount(async () => {
    // Initialize sound effects
    initSounds();

    // Check for auth callback (clear URL params)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("auth") || urlParams.has("error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Check auth status first (cookie-based)
    await checkAuth();

    // Then fetch elements (will include user's collection if logged in)
    const res = await fetch("/api/elements", { credentials: "include" });
    allElements = await res.json();

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  });

  function onSidebarMouseDown(e: MouseEvent, el: Element) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    playSound("pickup");
    dragging = { el, isNew: true, offsetX: 50, offsetY: 15 };
    dragPos = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  function onCanvasMouseDown(e: MouseEvent, el: CanvasElement) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    e.stopPropagation();
    playSound("pickup");
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    dragging = { el, isNew: false, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    dragPos = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  // Touch event handlers
  function clearLongPressTimer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function onSidebarTouchStart(e: TouchEvent, el: Element) {
    e.preventDefault();
    playSound("pickup");
    const touch = e.touches[0];
    dragging = { el, isNew: true, offsetX: 50, offsetY: 15 };
    dragPos = { x: touch.clientX, y: touch.clientY };
    dragMoved = false;
    longPressTriggered = false;

    // Start long press timer for showing info
    clearLongPressTimer();
    longPressTimer = setTimeout(() => {
      if (!dragMoved && el.type === "artist") {
        longPressTriggered = true;
        showElementInfo(el);
        dragging = null;
      }
    }, 500);
  }

  function onCanvasTouchStart(e: TouchEvent, el: CanvasElement) {
    e.preventDefault();
    e.stopPropagation();
    playSound("pickup");
    const touch = e.touches[0];
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    dragging = { el, isNew: false, offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
    dragPos = { x: touch.clientX, y: touch.clientY };
    dragMoved = false;
    longPressTriggered = false;

    // Start long press timer for showing info
    clearLongPressTimer();
    longPressTimer = setTimeout(() => {
      if (!dragMoved && el.type === "artist") {
        longPressTriggered = true;
        showElementInfo(el);
        dragging = null;
      }
    }, 500);
  }

  function onTouchMove(e: TouchEvent) {
    if (!dragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - dragPos.x;
    const dy = touch.clientY - dragPos.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragMoved = true;
      clearLongPressTimer(); // Cancel long press if moved
      sidebarOpen = false; // Close sidebar when dragging
    }
    dragPos = { x: touch.clientX, y: touch.clientY };

    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      nearTarget = findNearElement(x, y, dragging.el);
    }
  }

  function onTouchEnd(e: TouchEvent) {
    clearLongPressTimer();

    // If long press already triggered, just reset
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }

    if (!dragging || !canvasEl) {
      dragging = null;
      nearTarget = null;
      return;
    }

    // Use last known position from dragPos
    const clientX = dragPos.x;
    const clientY = dragPos.y;

    // Simple tap = play preview
    if (!dragMoved) {
      playPreview(dragging.el);
      dragging = null;
      nearTarget = null;
      return;
    }

    // Play drop sound (combine sound will override if combining)
    if (!nearTarget) playSound("drop");

    const canvasRect = canvasEl.getBoundingClientRect();
    const sidebarRect = sidebarEl?.getBoundingClientRect();
    const x = clientX - canvasRect.left - dragging.offsetX;
    const y = clientY - canvasRect.top - dragging.offsetY;

    if (sidebarRect && !dragging.isNew && clientX >= sidebarRect.left && clientX <= sidebarRect.right) {
      const el = dragging.el as CanvasElement;
      canvas = canvas.filter(c => c.instanceId !== el.instanceId);
    }
    else if (clientX >= canvasRect.left && clientX <= canvasRect.right && clientY >= canvasRect.top && clientY <= canvasRect.bottom) {
      if (nearTarget) {
        const targetId = nearTarget.instanceId;
        combineElements(dragging.el, nearTarget, nearTarget.x, nearTarget.y);
        canvas = canvas.filter(c => c.instanceId !== targetId);
        if (!dragging.isNew && 'instanceId' in dragging.el) {
          canvas = canvas.filter(c => c.instanceId !== (dragging!.el as CanvasElement).instanceId);
        }
      } else if (dragging.isNew) {
        spawnElement(dragging.el, x, y);
      } else {
        const el = dragging.el as CanvasElement;
        canvas = canvas.map(c => c.instanceId === el.instanceId ? { ...c, x, y } : c);
      }
    }

    dragging = null;
    nearTarget = null;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragPos.x;
    const dy = e.clientY - dragPos.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragMoved = true;
    }
    dragPos = { x: e.clientX, y: e.clientY };

    // Check proximity to other elements
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      nearTarget = findNearElement(x, y, dragging.el);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging || !canvasEl) {
      dragging = null;
      nearTarget = null;
      return;
    }

    // If no drag movement, treat as a click to play preview
    if (!dragMoved) {
      playPreview(dragging.el);
      dragging = null;
      nearTarget = null;
      return;
    }

    // Play drop sound (combine sound will override if combining)
    if (!nearTarget) playSound("drop");

    const canvasRect = canvasEl.getBoundingClientRect();
    const sidebarRect = sidebarEl?.getBoundingClientRect();
    const x = e.clientX - canvasRect.left - dragging.offsetX;
    const y = e.clientY - canvasRect.top - dragging.offsetY;

    // Check if dropped on sidebar (put back)
    if (sidebarRect && !dragging.isNew && e.clientX >= sidebarRect.left && e.clientX <= sidebarRect.right) {
      const el = dragging.el as CanvasElement;
      canvas = canvas.filter(c => c.instanceId !== el.instanceId);
    }
    // Check if dropped in canvas area
    else if (e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom) {
      if (nearTarget) {
        // Combine! Remove both elements
        const targetId = nearTarget.instanceId;
        combineElements(dragging.el, nearTarget, nearTarget.x, nearTarget.y);
        canvas = canvas.filter(c => c.instanceId !== targetId);
        if (!dragging.isNew && 'instanceId' in dragging.el) {
          canvas = canvas.filter(c => c.instanceId !== (dragging!.el as CanvasElement).instanceId);
        }
      } else if (dragging.isNew) {
        // Spawn new
        spawnElement(dragging.el, x, y);
      } else {
        // Move existing
        const el = dragging.el as CanvasElement;
        canvas = canvas.map(c => c.instanceId === el.instanceId ? { ...c, x, y } : c);
      }
    }

    dragging = null;
    nearTarget = null;
  }

  function findNearElement(x: number, y: number, exclude: Element): CanvasElement | null {
    const threshold = 60;
    for (const el of canvas) {
      if ('instanceId' in exclude && el.instanceId === (exclude as CanvasElement).instanceId) continue;
      const cx = el.x + 50;
      const cy = el.y + 15;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < threshold) return el;
    }
    return null;
  }

  function spawnElement(el: Element, x: number, y: number) {
    canvas = [...canvas, { ...el, x, y, instanceId: crypto.randomUUID() }];
  }

  async function combineElements(a: Element, b: Element, x: number, y: number) {
    nearTarget = null;
    playSound("combine");

    // Create a loading placeholder
    const loadingId = crypto.randomUUID();
    const loadingEl: LoadingElement = {
      instanceId: loadingId,
      x,
      y,
      elementA: a.name,
      elementB: b.name,
    };
    loadingCombinations = [...loadingCombinations, loadingEl];

    try {
      const res = await fetch("/api/combine", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elementA: a.id, elementB: b.id }),
      });
      const data = await res.json();
      result = data;
      resultPos = { x, y };

      if (data.result) {
        playSound("success");
        if (!allElements.find(e => e.name === data.result.name)) {
          allElements = [...allElements, data.result];
        }
        spawnElement(data.result, x, y);

        // Show help tooltip on first successful combine
        if (!localStorage.getItem("seenHelp")) {
          setTimeout(() => {
            showHelp = true;
            localStorage.setItem("seenHelp", "1");
          }, 2000);
        }
      } else if (data.noMatch) {
        playSound("fail");
        result = { noMatch: true, message: "No match found" };
      }
    } finally {
      // Remove the loading placeholder
      loadingCombinations = loadingCombinations.filter(l => l.instanceId !== loadingId);
    }
  }

  function clearCanvas() {
    canvas = [];
    result = null;
  }

  async function showElementInfo(el: Element) {
    if (el.type !== "artist") return;
    loadingInfo = true;
    try {
      const res = await fetch(`/api/artist/${encodeURIComponent(el.name)}`);
      const data = await res.json();
      if (data.name) {
        selectedInfo = data;
      }
    } finally {
      loadingInfo = false;
    }
  }

  function closeInfo() {
    selectedInfo = null;
  }

  function onRightClick(e: MouseEvent, el: Element) {
    e.preventDefault();
    showElementInfo(el);
  }

  // Audio preview functions
  async function playPreview(el: Element) {
    if (el.type !== "artist") return;

    // If clicking same artist, toggle play/pause
    if (nowPlaying?.artistName === el.name) {
      if (isPlaying) {
        audioEl.pause();
        isPlaying = false;
      } else {
        audioEl.play();
        isPlaying = true;
      }
      return;
    }

    // Fetch new preview
    try {
      const res = await fetch(`/api/preview/${encodeURIComponent(el.name)}`);
      if (!res.ok) return;
      const data = await res.json();

      nowPlaying = data;
      if (audioEl) {
        audioEl.src = data.previewUrl;
        audioEl.play();
        isPlaying = true;
      }
    } catch (e) {
      console.error("Failed to load preview:", e);
    }
  }

  function stopPreview() {
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    nowPlaying = null;
    isPlaying = false;
  }

  function onAudioEnded() {
    isPlaying = false;
  }
</script>

<div class="app">
  <button class="menu-btn" onclick={() => sidebarOpen = !sidebarOpen}>
    {sidebarOpen ? '✕' : '☰'}
  </button>

  <aside class="sidebar" class:open={sidebarOpen} bind:this={sidebarEl}>
    <h1>Music Craft</h1>
    <p class="hint">Drag to canvas, bring close to combine</p>

    {#if user}
      <div class="user-profile">
        {#if user.avatarUrl}
          <img src={user.avatarUrl} alt={user.displayName} class="user-avatar" />
        {/if}
        <div class="user-info">
          <span class="user-name">{user.displayName}</span>
          <button class="user-logout" onclick={logout}>Logout</button>
        </div>
      </div>
      <button class="spotify-import-btn" onclick={openImportModal}>
        Import from Spotify
      </button>
    {:else}
      <a href="/api/auth/login" class="spotify-login-btn">
        Login with Spotify
      </a>
    {/if}

    <div class="category">
      <h2>Genres <span class="count">{genres.length}</span></h2>
      <div class="elements">
        {#each genres as el (el.id)}
          <div
            class="element genre"
            onmousedown={(e) => onSidebarMouseDown(e, el)}
            ontouchstart={(e) => onSidebarTouchStart(e, el)}
          >
            {el.name}
          </div>
        {/each}
      </div>
    </div>

    <div class="category">
      <h2>Artists <span class="count">{artists.length}</span></h2>
      {#if pendingArtist}
        <div class="confirm-artist">
          <span class="confirm-label">Add "{pendingArtist.validated}"?</span>
          <div class="confirm-buttons">
            <button class="confirm-yes" onclick={confirmArtist} disabled={addingArtist}>Yes</button>
            <button class="confirm-no" onclick={cancelArtist}>No</button>
          </div>
        </div>
      {:else}
        <form class="add-artist" onsubmit={(e) => { e.preventDefault(); lookupArtist(); }}>
          <input
            type="text"
            placeholder="Add artist..."
            bind:value={newArtist}
            disabled={addingArtist}
          />
          <button type="submit" disabled={!newArtist.trim() || addingArtist}>+</button>
        </form>
      {/if}
      <div class="elements">
        {#each artists as el (el.id)}
          <div
            class="element artist"
            onmousedown={(e) => onSidebarMouseDown(e, el)}
            ontouchstart={(e) => onSidebarTouchStart(e, el)}
            oncontextmenu={(e) => onRightClick(e, el)}
          >
            {el.name}
          </div>
        {/each}
      </div>
    </div>

    <div class="sidebar-actions">
      <button class="mute-btn" onclick={toggleMute} title={soundsMuted ? "Unmute sounds" : "Mute sounds"}>
        {soundsMuted ? "🔇" : "🔊"}
      </button>
      <button class="clear" onclick={clearCanvas}>Clear Canvas</button>
    </div>
  </aside>

  <main class="canvas" bind:this={canvasEl}>
    {#each loadingCombinations as loading (loading.instanceId)}
      <div
        class="canvas-element loading-element"
        style="left: {loading.x}px; top: {loading.y}px;"
      >
        <div class="loading-content">
          <div class="spinner-small"></div>
          <span class="loading-text">Mixing...</span>
        </div>
      </div>
    {/each}

    {#each canvas as el (el.instanceId)}
      <div
        class="canvas-element"
        class:genre={el.type === "genre"}
        class:artist={el.type === "artist"}
        class:highlight={nearTarget?.instanceId === el.instanceId}
        style="left: {el.x}px; top: {el.y}px;"
        onmousedown={(e) => onCanvasMouseDown(e, el)}
        ontouchstart={(e) => onCanvasTouchStart(e, el)}
        oncontextmenu={(e) => onRightClick(e, el)}
      >
        {el.name}
      </div>
    {/each}

    {#if canvas.length === 0 && !dragging}
      <div class="empty">Drag elements here</div>
    {/if}

    <!-- First-time help tooltip -->
    {#if showHelp}
      <button class="help-tooltip" style="left: {resultPos.x + 80}px; top: {resultPos.y - 10}px;" onclick={() => showHelp = false}>
        <div class="help-row desktop-only"><span class="help-key">Click</span> to preview</div>
        <div class="help-row desktop-only"><span class="help-key">Right-click</span> for info</div>
        <div class="help-row mobile-only"><span class="help-key">Tap</span> to preview</div>
        <div class="help-row mobile-only"><span class="help-key">Hold</span> for info</div>
      </button>
    {/if}

    <!-- Discovery speech bubble -->
    {#if result?.result && result.combination?.summary}
      <button class="discovery-bubble" class:genre={result.result.type === "genre"} class:artist={result.result.type === "artist"} style="left: {resultPos.x}px; top: {resultPos.y - 45}px;" onclick={() => result = null}>
        {result.combination.summary}
        <span class="bubble-arrow"></span>
      </button>
    {:else if result?.noMatch}
      <button class="discovery-bubble no-match" style="left: {resultPos.x}px; top: {resultPos.y - 40}px;" onclick={() => result = null}>
        <span class="bubble-name">No match found</span>
        <span class="bubble-arrow"></span>
      </button>
    {/if}
  </main>

  {#if dragging && dragMoved}
    <div
      class="drag-ghost"
      class:genre={dragging.el.type === "genre"}
      class:artist={dragging.el.type === "artist"}
      style="left: {dragPos.x - dragging.offsetX}px; top: {dragPos.y - dragging.offsetY}px;"
    >
      {dragging.el.name}
    </div>
  {/if}

  {#if selectedInfo}
    <div class="info-overlay" onclick={closeInfo}>
      <div class="info-modal" onclick={(e) => e.stopPropagation()}>
        <button class="info-close" onclick={closeInfo}>&times;</button>
        <h2>{selectedInfo.name}</h2>
        <div class="info-stats">
          <span>{selectedInfo.listeners?.toLocaleString()} listeners</span>
        </div>
        {#if selectedInfo.tags?.length}
          <div class="info-tags">
            {#each selectedInfo.tags.slice(0, 5) as tag}
              <span class="info-tag">{tag}</span>
            {/each}
          </div>
        {/if}
        {#if selectedInfo.bio}
          <p class="info-bio">{@html selectedInfo.bio}</p>
        {/if}
        {#if selectedInfo.url}
          <a class="info-link" href={selectedInfo.url} target="_blank">View on Last.fm</a>
        {/if}
      </div>
    </div>
  {/if}

  {#if loadingInfo}
    <div class="info-overlay">
      <div class="info-loading">Loading...</div>
    </div>
  {/if}

  {#if showImportModal}
    <div class="info-overlay" onclick={closeImportModal}>
      <div class="import-modal" onclick={(e) => e.stopPropagation()}>
        <button class="info-close" onclick={closeImportModal}>&times;</button>
        <h2>Import from Spotify</h2>
        <p class="import-desc">Add your favorite artists and their genres to your collection. These will appear in the sidebar for crafting.</p>

        {#if loadingTopArtists}
          <div class="import-loading">Loading your top artists...</div>
        {:else if topArtists.length === 0}
          <p class="import-empty">No top artists found. Listen to more music on Spotify first.</p>
        {:else}
          <div class="import-header">
            <span class="import-hint">{selectedArtists.size} of {topArtists.length} selected</span>
            <div class="import-select-btns">
              <button class="select-btn" onclick={selectAllArtists}>Select All</button>
              <button class="select-btn" onclick={deselectAllArtists}>Clear</button>
            </div>
          </div>
          <div class="import-grid">
            {#each topArtists as artist (artist.id)}
              <div
                class="import-card"
                class:selected={selectedArtists.has(artist.id)}
                onclick={() => toggleArtistSelection(artist.id)}
              >
                {#if artist.imageUrl}
                  <img src={artist.imageUrl} alt={artist.name} class="import-card-img" />
                {:else}
                  <div class="import-card-img placeholder"></div>
                {/if}
                <div class="import-card-info">
                  <span class="import-card-name">{artist.name}</span>
                  {#if artist.genres.length > 0}
                    <span class="import-card-genres">{artist.genres.slice(0, 2).join(", ")}</span>
                  {/if}
                </div>
                <div class="import-card-check">
                  {#if selectedArtists.has(artist.id)}✓{/if}
                </div>
              </div>
            {/each}
          </div>
          <div class="import-actions">
            <button
              class="import-btn"
              onclick={importSelectedArtists}
              disabled={selectedArtists.size === 0 || importingArtists}
            >
              {importingArtists ? "Importing..." : `Import ${selectedArtists.size} Artist${selectedArtists.size !== 1 ? 's' : ''} + Genres`}
            </button>
            <button class="import-cancel" onclick={closeImportModal}>Cancel</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Hidden audio element -->
  <audio bind:this={audioEl} onended={onAudioEnded}></audio>

  <!-- Now playing indicator -->
  {#if nowPlaying}
    <div class="now-playing">
      {#if nowPlaying.albumArt}
        <img src={nowPlaying.albumArt} alt="" class="now-playing-art" />
      {/if}
      <div class="now-playing-info">
        <span class="now-playing-artist">{nowPlaying.artistName}</span>
        <span class="now-playing-track">{nowPlaying.trackName}</span>
      </div>
      <button class="now-playing-btn" onclick={() => isPlaying ? (audioEl.pause(), isPlaying = false) : (audioEl.play(), isPlaying = true)}>
        {isPlaying ? "||" : "▶"}
      </button>
      <button class="now-playing-close" onclick={stopPreview}>&times;</button>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .sidebar {
    width: 300px;
    background: linear-gradient(180deg, #0f0f12 0%, #0a0a0d 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #1a1a20;
    overflow-y: auto;
    gap: 1rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
  }

  .hint {
    color: #555;
    font-size: 0.75rem;
  }

  .category h2 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #444;
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .category h2 .count {
    background: #1a1a20;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.65rem;
  }

  .confirm-artist {
    background: rgba(244, 114, 182, 0.1);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 8px;
    padding: 0.6rem;
    margin-bottom: 0.5rem;
  }

  .confirm-label {
    display: block;
    font-size: 0.8rem;
    margin-bottom: 0.4rem;
    color: #fff;
  }

  .confirm-buttons {
    display: flex;
    gap: 0.35rem;
  }

  .confirm-yes, .confirm-no {
    flex: 1;
    padding: 0.35rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    border: none;
  }

  .confirm-yes {
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
  }

  .confirm-yes:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.3);
  }

  .confirm-no {
    background: #27272a;
    color: #888;
  }

  .confirm-no:hover {
    background: #333;
    color: #fff;
  }

  .add-artist {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .add-artist input {
    flex: 1;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    color: #fff;
    font-size: 0.75rem;
  }

  .add-artist input::placeholder {
    color: #444;
  }

  .add-artist input:focus {
    outline: none;
    border-color: rgba(244, 114, 182, 0.5);
  }

  .add-artist button {
    background: rgba(244, 114, 182, 0.2);
    border: 1px solid rgba(244, 114, 182, 0.4);
    border-radius: 6px;
    color: #f472b6;
    padding: 0 0.6rem;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .add-artist button:hover:not(:disabled) {
    background: rgba(244, 114, 182, 0.3);
  }

  .add-artist button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .elements {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .element, .canvas-element, .drag-ghost {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font-size: 0.8rem;
    cursor: grab;
    user-select: none;
    white-space: nowrap;
    transition: transform 0.1s ease, box-shadow 0.1s ease, border-color 0.1s ease;
  }

  .element:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .element.genre, .canvas-element.genre, .drag-ghost.genre {
    border-color: rgba(251, 191, 36, 0.4);
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), #18181b);
  }

  .element.artist, .canvas-element.artist, .drag-ghost.artist {
    border-color: rgba(244, 114, 182, 0.4);
    background: linear-gradient(135deg, rgba(244, 114, 182, 0.08), #18181b);
  }

  .canvas-element {
    position: absolute;
    z-index: 1;
  }

  .canvas-element.highlight {
    transform: scale(1.1);
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
    z-index: 2;
  }

  .canvas-element.highlight.genre {
    box-shadow: 0 0 20px rgba(251, 191, 36, 0.4);
  }

  .canvas-element.highlight.artist {
    box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
  }

  .drag-ghost {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    opacity: 0.9;
    transform: scale(1.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .sidebar-actions {
    margin-top: auto;
    display: flex;
    gap: 0.5rem;
  }

  .mute-btn {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.6rem;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.15s ease;
  }

  .mute-btn:hover {
    background: #27272a;
  }

  .clear {
    flex: 1;
    background: #18181b;
    color: #666;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.6rem;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.15s ease;
  }

  .clear:hover {
    background: #27272a;
    color: #fff;
  }

  .canvas {
    flex: 1;
    background-color: #050507;
    background-image: radial-gradient(circle, #1a1a20 1px, transparent 1px);
    background-size: 24px 24px;
    position: relative;
    overflow: hidden;
  }

  .loading-element {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), #18181b);
    border-color: rgba(168, 85, 247, 0.5);
    animation: pulse-border 1.5s ease-in-out infinite;
  }

  .loading-content {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid #27272a;
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .loading-text {
    font-size: 0.75rem;
    color: #a855f7;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pulse-border {
    0%, 100% { border-color: rgba(168, 85, 247, 0.4); }
    50% { border-color: rgba(168, 85, 247, 0.7); }
  }

  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #27272a;
    font-size: 1.25rem;
  }

  .help-tooltip {
    position: absolute;
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    z-index: 20;
    cursor: pointer;
    animation: fadeSlideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .help-row {
    font-size: 0.75rem;
    color: #a1a1aa;
    margin-bottom: 0.2rem;
    white-space: nowrap;
  }

  .help-row:last-child {
    margin-bottom: 0;
  }

  .help-key {
    color: #fff;
    font-weight: 500;
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 768px) {
    .desktop-only {
      display: none;
    }
    .mobile-only {
      display: block;
    }
  }

  .info-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .info-modal {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
  }

  .info-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: #666;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }

  .info-close:hover {
    color: #fff;
  }

  .info-modal h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    color: #f472b6;
  }

  .info-stats {
    color: #666;
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
  }

  .info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .info-tag {
    background: rgba(244, 114, 182, 0.15);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font-size: 0.7rem;
    color: #f472b6;
  }

  .info-bio {
    color: #999;
    font-size: 0.85rem;
    line-height: 1.5;
    margin: 0 0 1rem;
  }

  .info-bio a {
    color: #60a5fa;
  }

  .info-link {
    display: inline-block;
    background: rgba(96, 165, 250, 0.15);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: #60a5fa;
    text-decoration: none;
  }

  .info-link:hover {
    background: rgba(96, 165, 250, 0.25);
  }

  .info-loading {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 1rem 2rem;
    color: #fff;
  }

  /* Spotify Login/User Profile */
  .spotify-login-btn, .spotify-import-btn {
    display: block;
    width: 100%;
    background: rgba(30, 215, 96, 0.15);
    border: 1px solid rgba(30, 215, 96, 0.4);
    border-radius: 8px;
    padding: 0.6rem;
    color: #1ed760;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    text-align: center;
  }

  .spotify-login-btn:hover, .spotify-import-btn:hover {
    background: rgba(30, 215, 96, 0.25);
    transform: translateY(-1px);
  }

  .user-profile {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }

  .user-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .user-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #fff;
  }

  .user-logout {
    background: none;
    border: none;
    color: #666;
    font-size: 0.7rem;
    cursor: pointer;
    text-align: left;
    padding: 0;
  }

  .user-logout:hover {
    color: #f472b6;
  }

  /* Import Modal */
  .import-modal {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    max-width: 700px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    position: relative;
  }

  .import-modal h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    color: #1ed760;
  }

  .import-desc {
    color: #888;
    font-size: 0.8rem;
    margin: 0 0 1rem;
    line-height: 1.4;
  }

  .import-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .import-hint {
    color: #666;
    font-size: 0.8rem;
  }

  .import-select-btns {
    display: flex;
    gap: 0.5rem;
  }

  .select-btn {
    background: #27272a;
    border: none;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    color: #999;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .select-btn:hover {
    background: #333;
    color: #fff;
  }

  .import-loading, .import-empty {
    color: #999;
    padding: 2rem;
    text-align: center;
  }

  .import-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 0.25rem;
  }

  .import-card {
    background: #1f1f23;
    border: 2px solid transparent;
    border-radius: 10px;
    padding: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }

  .import-card:hover {
    background: #27272a;
    border-color: rgba(30, 215, 96, 0.3);
  }

  .import-card.selected {
    background: rgba(30, 215, 96, 0.1);
    border-color: #1ed760;
  }

  .import-card-img {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    object-fit: cover;
    margin-bottom: 0.5rem;
  }

  .import-card-img.placeholder {
    background: #27272a;
  }

  .import-card-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .import-card-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-card-genres {
    font-size: 0.65rem;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-card-check {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    border: 2px solid #27272a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: #1ed760;
    transition: all 0.15s ease;
  }

  .import-card.selected .import-card-check {
    border-color: #1ed760;
    background: #1ed760;
    color: #000;
  }

  .import-actions {
    display: flex;
    gap: 0.5rem;
  }

  .import-btn {
    flex: 1;
    background: rgba(30, 215, 96, 0.2);
    border: 1px solid rgba(30, 215, 96, 0.4);
    border-radius: 8px;
    padding: 0.6rem 1rem;
    color: #1ed760;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .import-btn:hover:not(:disabled) {
    background: rgba(30, 215, 96, 0.3);
  }

  .import-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .import-cancel {
    background: #27272a;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.6rem 1rem;
    color: #888;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .import-cancel:hover {
    background: #333;
    color: #fff;
  }

  /* Now Playing */
  .now-playing {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .now-playing-art {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    object-fit: cover;
  }

  .now-playing-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-width: 180px;
  }

  .now-playing-artist {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f472b6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-playing-track {
    font-size: 0.7rem;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-playing-btn {
    background: rgba(244, 114, 182, 0.15);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    color: #f472b6;
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .now-playing-btn:hover {
    background: rgba(244, 114, 182, 0.25);
  }

  .now-playing-close {
    background: none;
    border: none;
    color: #555;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .now-playing-close:hover {
    color: #fff;
  }

  /* Discovery speech bubble */
  .discovery-bubble {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    border: none;
    border-radius: 10px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    z-index: 10;
    animation: bubblePop 0.25s ease-out;
    color: #000;
    font-size: 0.75rem;
    transform: translateX(-50%);
    max-width: 220px;
    text-align: center;
  }

  .discovery-bubble.genre {
    background: #fbbf24;
    box-shadow: 0 4px 12px rgba(251, 191, 36, 0.5);
  }

  .discovery-bubble.artist {
    background: #f472b6;
    box-shadow: 0 4px 12px rgba(244, 114, 182, 0.5);
  }

  @keyframes bubblePop {
    from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.9); }
    to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }

  .discovery-bubble.genre:hover {
    background: #f59e0b;
  }

  .discovery-bubble.artist:hover {
    background: #ec4899;
  }

  .discovery-bubble.no-match {
    background: #ef4444;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5);
    color: #fff;
  }

  .discovery-bubble.no-match:hover {
    background: #dc2626;
  }

  .bubble-arrow {
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid #f472b6;
  }

  .discovery-bubble.genre .bubble-arrow {
    border-top-color: #fbbf24;
  }

  .discovery-bubble.genre:hover .bubble-arrow {
    border-top-color: #f59e0b;
  }

  .discovery-bubble.artist:hover .bubble-arrow {
    border-top-color: #ec4899;
  }

  .discovery-bubble.no-match .bubble-arrow {
    border-top-color: #ef4444;
  }

  .discovery-bubble.no-match:hover .bubble-arrow {
    border-top-color: #dc2626;
  }

  /* Mobile menu button */
  .menu-btn {
    display: none;
    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 1001;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    width: 44px;
    height: 44px;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    align-items: center;
    justify-content: center;
  }

  .menu-btn:hover {
    background: #27272a;
  }

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .menu-btn {
      display: flex;
    }

    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 1000;
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      width: 280px;
    }

    .sidebar.open {
      transform: translateX(0);
    }

    .canvas {
      width: 100%;
    }

    .now-playing {
      left: 1rem;
      right: 1rem;
      bottom: 1rem;
      max-width: none;
    }

    .now-playing-info {
      flex: 1;
      max-width: none;
    }

    .info-modal, .import-modal {
      width: 95%;
      max-height: 90vh;
      margin: 1rem;
    }

    .import-grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }

    .element, .canvas-element {
      touch-action: none;
    }

    h1 {
      margin-top: 2.5rem;
    }
  }
</style>

'use strict';

const $ = (selector) => document.querySelector(selector);

const els = {
  audioInput: $('#audio-input'),
  audioPlayer: $('#audio-player'),
  videoPlayer: $('#video-player'),
  audioVisual: $('#audio-visual'),
  dropzone: $('#dropzone'),
  pickFilesButton: $('#pick-files-button'),
  linkForm: $('#link-form'),
  trackUrl: $('#track-url'),
  trackTitle: $('#track-title'),
  trackArtist: $('#track-artist'),
  statusBanner: $('#status-banner'),
  searchInput: $('#search-input'),
  sortSelect: $('#sort-select'),
  speedSelect: $('#speed-select'),
  playlist: $('#playlist'),
  trackTemplate: $('#track-template'),
  heroCurrentTrack: $('#hero-current-track'),
  heroCurrentMeta: $('#hero-current-meta'),
  heroTrackCount: $('#hero-track-count'),
  playerCard: $('#player-card'),
  currentSource: $('#current-source'),
  currentTitle: $('#current-title'),
  currentArtist: $('#current-artist'),
  playButton: $('#play-button'),
  prevButton: $('#prev-button'),
  nextButton: $('#next-button'),
  shuffleButton: $('#shuffle-button'),
  repeatButton: $('#repeat-button'),
  progressRange: $('#progress-range'),
  currentTime: $('#current-time'),
  duration: $('#duration'),
  volumeRange: $('#volume-range'),
  muteButton: $('#mute-button'),
  statFiles: $('#stat-files'),
  statVisible: $('#stat-visible'),
  statDuration: $('#stat-duration'),
  statState: $('#stat-state')
};

const STORAGE = {
  dbName: 'audio-track-player',
  storeName: 'tracks',
  version: 1,
  playbackRateKey: 'audio-track-player.playback-rate'
};

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|ogv)$/i;

const state = {
  tracks: [],
  currentId: null,
  isPlaying: false,
  shuffle: false,
  repeatMode: 'all',
  history: [],
  volumeBeforeMute: 0.8,
  playbackRate: 1
};

let dbPromise = null;
let storageAvailable = true;

els.audioPlayer.volume = state.volumeBeforeMute;
els.videoPlayer.volume = state.volumeBeforeMute;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getMediaTypeFromFile(file) {
  if (!file) {
    return null;
  }

  if (typeof file.type === 'string') {
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('video/')) return 'video';
  }

  if (AUDIO_EXTENSIONS.test(file.name)) return 'audio';
  if (VIDEO_EXTENSIONS.test(file.name)) return 'video';

  return null;
}

function getMediaTypeFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    if (VIDEO_EXTENSIONS.test(pathname)) return 'video';
    if (AUDIO_EXTENSIONS.test(pathname)) return 'audio';
  } catch {
    return 'audio';
  }

  return 'audio';
}

function inferTitleFromName(name) {
  const withoutExt = name.replace(/\.[^.]+$/, '');
  const normalized = normalizeText(withoutExt.replace(/[_-]+/g, ' '));
  return normalized || '未命名媒体';
}

function inferTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return inferTitleFromName(decodeURIComponent(fileName || '外部媒体'));
  } catch {
    return '外部媒体';
  }
}

function inferFormatFromName(name, mime = '') {
  const extension = name.includes('.') ? name.split('.').pop() : '';
  if (extension) {
    return extension.toUpperCase();
  }

  if (mime && mime.includes('/')) {
    const subtype = mime.split('/')[1];
    return subtype ? subtype.toUpperCase() : 'MEDIA';
  }

  return 'MEDIA';
}

function inferFormatFromUrl(url) {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() || '';
    return inferFormatFromName(fileName || 'media', '');
  } catch {
    return 'MEDIA';
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function mediaLabel(track) {
  return track?.mediaType === 'video' ? '视频' : '音频';
}

function sourceLabel(track) {
  const label = mediaLabel(track);
  return track.sourceType === 'file' ? `本地${label}文件` : `${label}链接`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  const precision = value >= 100 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatPlaybackRate(rate) {
  return `${rate}x`;
}

function normalizePlaybackRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return 1;
  }

  return PLAYBACK_RATES.reduce((closest, candidate) => {
    return Math.abs(candidate - rate) < Math.abs(closest - rate) ? candidate : closest;
  }, PLAYBACK_RATES[1]);
}

function getErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || error.error_description || error.msg || fallback;
}

function setStatus(message, tone = 'info') {
  els.statusBanner.textContent = message;
  els.statusBanner.classList.remove('is-success', 'is-error');

  if (tone === 'success') {
    els.statusBanner.classList.add('is-success');
  } else if (tone === 'error') {
    els.statusBanner.classList.add('is-error');
  }
}

function loadPlaybackRate() {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE.playbackRateKey));
    return normalizePlaybackRate(stored);
  } catch {
    return 1;
  }
}

function savePlaybackRate(rate) {
  try {
    window.localStorage.setItem(STORAGE.playbackRateKey, String(rate));
  } catch {
    return;
  }
}

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(STORAGE.dbName, STORAGE.version);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORAGE.storeName)) {
          db.createObjectStore(STORAGE.storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

async function getDatabase() {
  if (!storageAvailable) {
    return null;
  }

  try {
    return await openDatabase();
  } catch (error) {
    storageAvailable = false;
    console.error('IndexedDB unavailable:', error);
    return null;
  }
}

function storageRecordForTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    sourceType: track.sourceType,
    mediaType: track.mediaType || 'audio',
    src: track.sourceType === 'url' ? track.src : '',
    fileName: track.fileName,
    size: track.size,
    duration: track.duration,
    format: track.format,
    addedAt: track.addedAt,
    blob: track.sourceType === 'file' ? track.blob || null : null
  };
}

function hydrateStoredTrack(record) {
  if (!record || !record.id || !record.sourceType) {
    return null;
  }

  const mediaType = record.mediaType === 'video' ? 'video' : 'audio';
  const track = {
    id: record.id,
    title: normalizeText(record.title) || '未命名媒体',
    artist: normalizeText(record.artist),
    sourceType: record.sourceType,
    mediaType,
    src: '',
    objectUrl: null,
    fileName: normalizeText(record.fileName),
    size: Number.isFinite(Number(record.size)) ? Number(record.size) : null,
    duration: Number.isFinite(Number(record.duration)) ? Number(record.duration) : null,
    format: normalizeText(record.format) || 'MEDIA',
    addedAt: Number(record.addedAt) || Date.now(),
    blob: record.blob || null
  };

  if (record.sourceType === 'file') {
    if (!(record.blob instanceof Blob)) {
      return null;
    }

    const objectUrl = URL.createObjectURL(record.blob);
    track.src = objectUrl;
    track.objectUrl = objectUrl;
    track.blob = record.blob;

    if (!track.fileName) {
      track.fileName = track.title;
    }

    if (!track.format || track.format === 'MEDIA') {
      track.format = inferFormatFromName(track.fileName || track.title, record.blob.type || '');
    }
  } else if (record.sourceType === 'url') {
    const src = normalizeText(record.src);
    if (!src) {
      return null;
    }

    track.src = src;
    track.blob = null;

    if (!track.fileName) {
      track.fileName = inferTitleFromUrl(src);
    }

    if (!track.format || track.format === 'MEDIA') {
      track.format = inferFormatFromUrl(src);
    }
  } else {
    return null;
  }

  return track;
}

async function loadStoredTracks() {
  const db = await getDatabase();
  if (!db) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE.storeName, 'readonly');
    const store = tx.objectStore(STORAGE.storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = Array.isArray(request.result) ? request.result : [];
      resolve(records.map(hydrateStoredTrack).filter(Boolean));
    };

    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
  });
}

async function persistTrack(track) {
  const db = await getDatabase();
  if (!db) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE.storeName, 'readwrite');
    const store = tx.objectStore(STORAGE.storeName);
    const request = store.put(storageRecordForTrack(track));

    request.onerror = () => reject(request.error || new Error('IndexedDB write failed'));
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

async function deletePersistedTrack(trackId) {
  const db = await getDatabase();
  if (!db) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORAGE.storeName, 'readwrite');
    const store = tx.objectStore(STORAGE.storeName);
    const request = store.delete(trackId);

    request.onerror = () => reject(request.error || new Error('IndexedDB delete failed'));
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
  });
}

function getTrackById(trackId) {
  return state.tracks.find((track) => track.id === trackId) || null;
}

function getCurrentTrack() {
  return state.currentId ? getTrackById(state.currentId) : null;
}

function getActiveMediaElement(track = getCurrentTrack()) {
  return track?.mediaType === 'video' ? els.videoPlayer : els.audioPlayer;
}

function getInactiveMediaElement(track = getCurrentTrack()) {
  return track?.mediaType === 'video' ? els.audioPlayer : els.videoPlayer;
}

function syncSharedMediaSettings() {
  for (const media of [els.audioPlayer, els.videoPlayer]) {
    media.playbackRate = state.playbackRate;
  }
}

function syncMediaElementForTrack(track) {
  const activeMedia = getActiveMediaElement(track);
  const inactiveMedia = getInactiveMediaElement(track);

  inactiveMedia.pause();
  inactiveMedia.removeAttribute('src');
  inactiveMedia.load();
  activeMedia.volume = state.volumeBeforeMute;
  activeMedia.playbackRate = state.playbackRate;

  return activeMedia;
}

function getTrackSearchText(track) {
  return [
    track.title,
    track.artist,
    track.fileName,
    sourceLabel(track),
    track.format,
    track.size ? formatBytes(track.size) : ''
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getTracks({ includeSearch = true } = {}) {
  const keyword = includeSearch ? els.searchInput.value.trim().toLowerCase() : '';
  let list = [...state.tracks];

  if (keyword) {
    list = list.filter((track) => getTrackSearchText(track).includes(keyword));
  }

  const sort = els.sortSelect.value;

  list.sort((a, b) => {
    if (sort === 'title') {
      return a.title.localeCompare(b.title, 'zh-CN');
    }

    if (sort === 'duration') {
      const durationA = Number.isFinite(a.duration) ? a.duration : -1;
      const durationB = Number.isFinite(b.duration) ? b.duration : -1;

      if (durationB !== durationA) {
        return durationB - durationA;
      }

      return b.addedAt - a.addedAt;
    }

    return b.addedAt - a.addedAt;
  });

  return list;
}

function getVisibleTracks() {
  return getTracks({ includeSearch: true });
}

function getPlaybackTracks() {
  const visible = getVisibleTracks();
  return visible.length ? visible : getTracks({ includeSearch: false });
}

function totalDuration(list = state.tracks) {
  return list.reduce((sum, track) => sum + (Number.isFinite(track.duration) ? track.duration : 0), 0);
}

function buildTrackDetail(track, { includeDuration = false } = {}) {
  const parts = [];

  if (track.artist) {
    parts.push(track.artist);
  }

  parts.push(sourceLabel(track));

  if (track.size) {
    parts.push(formatBytes(track.size));
  }

  if (includeDuration && Number.isFinite(track.duration)) {
    parts.push(formatDuration(track.duration));
  }

  return parts.join(' · ');
}

function syncVolumeUI() {
  const media = getActiveMediaElement();
  els.volumeRange.value = media.muted ? '0' : String(Math.round(media.volume * 100));
}

function updateProgressUI() {
  const track = getCurrentTrack();
  const media = getActiveMediaElement(track);

  if (!track) {
    els.currentTime.textContent = '0:00';
    els.duration.textContent = '0:00';
    els.progressRange.value = '0';
    return;
  }

  const durationValue = Number.isFinite(media.duration) && media.duration > 0
    ? media.duration
    : Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 0;

  els.currentTime.textContent = formatDuration(media.currentTime);
  els.duration.textContent = durationValue ? formatDuration(durationValue) : '--:--';
  els.progressRange.value = durationValue ? String(Math.round((media.currentTime / durationValue) * 1000)) : '0';
}

function renderPlayer() {
  const track = getCurrentTrack();

  if (state.currentId && !track) {
    state.currentId = null;
  }

  const activeTrack = getCurrentTrack();
  const activeMedia = getActiveMediaElement(activeTrack);
  const hasTrack = Boolean(activeTrack);
  const isVideo = activeTrack?.mediaType === 'video';
  const playing = hasTrack && state.isPlaying;
  const repeatLabels = {
    off: '循环：关',
    all: '循环：列',
    one: '循环：单'
  };

  els.playerCard.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-playing', playing);
  els.videoPlayer.hidden = !isVideo;
  els.audioVisual.hidden = isVideo;

  els.currentSource.textContent = hasTrack ? sourceLabel(activeTrack) : '等待导入';
  els.currentTitle.textContent = hasTrack ? activeTrack.title : '尚未选择歌曲';
  els.currentArtist.textContent = hasTrack ? buildTrackDetail(activeTrack, { includeDuration: true }) : '导入音频或视频开始播放。';

  els.heroCurrentTrack.textContent = hasTrack ? activeTrack.title : '尚未选择歌曲';
  els.heroCurrentMeta.textContent = hasTrack
    ? `${playing ? '播放中' : '已暂停'} · ${buildTrackDetail(activeTrack, { includeDuration: true })}`
    : '导入一首歌或一个视频后就会显示在这里。';

  els.playButton.textContent = !hasTrack ? '播放' : playing ? '暂停' : '继续';
  els.playButton.disabled = !state.tracks.length;
  els.prevButton.disabled = !state.tracks.length;
  els.nextButton.disabled = !state.tracks.length;

  els.shuffleButton.textContent = state.shuffle ? '随机：开' : '随机：关';
  els.shuffleButton.classList.toggle('is-active', state.shuffle);
  els.shuffleButton.setAttribute('aria-pressed', String(state.shuffle));

  els.repeatButton.textContent = repeatLabels[state.repeatMode];
  els.repeatButton.classList.toggle('is-active', state.repeatMode !== 'off');
  els.repeatButton.setAttribute('aria-pressed', String(state.repeatMode !== 'off'));

  els.muteButton.textContent = activeMedia.muted ? '取消静音' : '静音';
  els.muteButton.classList.toggle('is-active', activeMedia.muted);
  els.muteButton.setAttribute('aria-pressed', String(activeMedia.muted));

  els.speedSelect.value = String(state.playbackRate);
  syncSharedMediaSettings();

  const durationValue = hasTrack && Number.isFinite(activeMedia.duration) && activeMedia.duration > 0
    ? activeMedia.duration
    : hasTrack && Number.isFinite(activeTrack.duration) && activeTrack.duration > 0
      ? activeTrack.duration
      : 0;

  const seekEnabled = hasTrack && durationValue > 0;
  els.progressRange.disabled = !seekEnabled;
  els.progressRange.value = seekEnabled ? String(Math.round((activeMedia.currentTime / durationValue) * 1000)) : '0';
  els.currentTime.textContent = hasTrack ? formatDuration(activeMedia.currentTime) : '0:00';
  els.duration.textContent = hasTrack ? formatDuration(durationValue) : '0:00';

  els.statState.textContent = hasTrack ? (playing ? '播放中' : '已暂停') : '未开始';

  syncVolumeUI();
}

function renderLibrary() {
  const list = getVisibleTracks();
  const total = state.tracks.length;

  els.statFiles.textContent = String(total);
  els.statVisible.textContent = String(list.length);
  els.statDuration.textContent = formatDuration(totalDuration());
  els.heroTrackCount.textContent = `${total} 个`;

  if (!list.length) {
    const emptyMessage = total
      ? '没有匹配到媒体，换个关键词试试。'
      : '尚未导入任何媒体。先拖入音频或视频文件，或者贴一个可播放的媒体链接。';

    els.playlist.innerHTML = `<div class="playlist-empty">${emptyMessage}</div>`;
    return;
  }

  els.playlist.innerHTML = '';

  list.forEach((track) => {
    const fragment = els.trackTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.track-item');
    const toggleButton = fragment.querySelector('.track-toggle');
    const removeButton = fragment.querySelector('.track-remove');

    const isCurrent = track.id === state.currentId;
    const isPlaying = isCurrent && state.isPlaying;

    card.dataset.trackId = track.id;
    card.classList.toggle('is-active', isCurrent);
    card.setAttribute('aria-current', isCurrent ? 'true' : 'false');

    fragment.querySelector('.track-title').textContent = track.title;
    fragment.querySelector('.track-duration').textContent = formatDuration(track.duration);
    fragment.querySelector('.track-artist').textContent = buildTrackDetail(track);
    fragment.querySelector('.source-chip').textContent = sourceLabel(track);
    fragment.querySelector('.format-chip').textContent = track.format || 'MEDIA';

    toggleButton.textContent = isCurrent ? (isPlaying ? '暂停' : '继续') : '播放';
    toggleButton.classList.toggle('is-active', isCurrent);
    toggleButton.setAttribute('aria-label', `${toggleButton.textContent} ${track.title}`);
    toggleButton.addEventListener('click', () => {
      void handleTrackToggle(track.id);
    });

    removeButton.setAttribute('aria-label', `移除 ${track.title}`);
    removeButton.addEventListener('click', () => {
      void removeTrack(track.id);
    });

    els.playlist.append(fragment);
  });
}

function createTrackFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const name = file.name || '未命名媒体';

  return {
    id: createId(),
    title: inferTitleFromName(name),
    artist: '',
    sourceType: 'file',
    mediaType: getMediaTypeFromFile(file),
    src: objectUrl,
    objectUrl,
    fileName: name,
    size: file.size,
    duration: null,
    format: inferFormatFromName(name, file.type),
    addedAt: Date.now(),
    blob: file
  };
}

function createTrackFromUrl(url, title, artist) {
  const inferredTitle = inferTitleFromUrl(url);
  const safeTitle = normalizeText(title) || inferredTitle;
  const safeArtist = normalizeText(artist);

  return {
    id: createId(),
    title: safeTitle,
    artist: safeArtist,
    sourceType: 'url',
    mediaType: getMediaTypeFromUrl(url),
    src: url,
    objectUrl: null,
    fileName: inferredTitle,
    size: null,
    duration: null,
    format: inferFormatFromUrl(url),
    addedAt: Date.now(),
    blob: null
  };
}

async function probeTrackDuration(track) {
  const current = getTrackById(track.id);
  if (!current || !current.src) {
    return null;
  }

  const probe = current.mediaType === 'video' ? document.createElement('video') : new Audio();
  probe.preload = 'metadata';
  probe.muted = true;

  const duration = await new Promise((resolve) => {
    const finish = (value) => {
      probe.src = '';
      resolve(value);
    };

    probe.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(probe.duration) ? probe.duration : null);
    }, { once: true });

    probe.addEventListener('error', () => {
      finish(null);
    }, { once: true });

    probe.src = current.src;
  });

  const liveTrack = getTrackById(track.id);
  if (!liveTrack) {
    return duration;
  }

  const previousDuration = liveTrack.duration;
  if (Number.isFinite(duration)) {
    liveTrack.duration = duration;
  }

  if (Number.isFinite(duration) && duration !== previousDuration) {
    void persistTrack(liveTrack);
  }

  if (state.currentId === liveTrack.id) {
    renderPlayer();
  }

  renderLibrary();
  return duration;
}

async function playTrack(trackId, { pushHistory = true, announce = true } = {}) {
  const track = getTrackById(trackId);
  if (!track) {
    return;
  }

  if (pushHistory && state.currentId && state.currentId !== trackId) {
    state.history.push(state.currentId);
  }

  state.currentId = trackId;
  state.isPlaying = false;

  const media = syncMediaElementForTrack(track);
  if (media.src !== track.src) {
    media.src = track.src;
    media.load();
  }

  renderPlayer();
  renderLibrary();

  try {
    await media.play();
    if (announce) {
      setStatus(`正在播放：${track.title}`, 'success');
    }
  } catch (error) {
    state.isPlaying = false;
    renderPlayer();
    setStatus(`播放失败：${getErrorMessage(error, '请检查链接或文件格式。')}`, 'error');
  }
}

async function togglePlay() {
  const current = getCurrentTrack();

  if (!current) {
    const firstTrack = getPlaybackTracks()[0];
    if (!firstTrack) {
      setStatus('当前没有可播放的媒体。', 'error');
      return;
    }

    await playTrack(firstTrack.id);
    return;
  }

  const media = getActiveMediaElement(current);
  if (state.isPlaying) {
    media.pause();
    return;
  }

  try {
    await media.play();
  } catch (error) {
    setStatus(`播放失败：${getErrorMessage(error, '请再点击一次播放按钮。')}`, 'error');
  }
}

function playNext({ respectRepeat = false } = {}) {
  const list = getPlaybackTracks();
  if (!list.length) {
    setStatus('当前没有可播放的媒体。', 'error');
    return;
  }

  if (respectRepeat && state.repeatMode === 'one' && state.currentId) {
    void playTrack(state.currentId, { pushHistory: false });
    return;
  }

  if (state.shuffle) {
    const candidates = list.filter((track) => track.id !== state.currentId);
    const target = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : list[0];

    void playTrack(target.id);
    return;
  }

  const currentIndex = list.findIndex((track) => track.id === state.currentId);

  if (currentIndex === -1) {
    void playTrack(list[0].id);
    return;
  }

  let nextIndex = currentIndex + 1;

  if (nextIndex >= list.length) {
    if (state.repeatMode === 'all') {
      nextIndex = 0;
    } else {
      setStatus('已经播放到最后一个。', 'info');
      return;
    }
  }

  void playTrack(list[nextIndex].id);
}

function playPrevious() {
  while (state.history.length) {
    const previousId = state.history.pop();
    if (getTrackById(previousId)) {
      void playTrack(previousId, { pushHistory: false });
      return;
    }
  }

  const list = getPlaybackTracks();
  if (!list.length) {
    setStatus('当前没有可播放的媒体。', 'error');
    return;
  }

  const currentIndex = list.findIndex((track) => track.id === state.currentId);

  if (currentIndex === -1) {
    const fallback = state.repeatMode === 'all' ? list[list.length - 1] : list[0];
    void playTrack(fallback.id);
    return;
  }

  let previousIndex = currentIndex - 1;

  if (previousIndex < 0) {
    if (state.repeatMode === 'all') {
      previousIndex = list.length - 1;
    } else {
      setStatus('已经是第一个了。', 'info');
      return;
    }
  }

  void playTrack(list[previousIndex].id);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  renderPlayer();
  setStatus(state.shuffle ? '随机播放已开启。' : '随机播放已关闭。', 'success');
}

function cycleRepeatMode() {
  const order = ['off', 'all', 'one'];
  const labels = {
    off: '循环已关闭',
    all: '列表循环',
    one: '单个循环'
  };

  const nextIndex = (order.indexOf(state.repeatMode) + 1) % order.length;
  state.repeatMode = order[nextIndex];
  renderPlayer();
  setStatus(`播放模式：${labels[state.repeatMode]}`, 'success');
}

function setMutedForAllMedia(muted) {
  els.audioPlayer.muted = muted;
  els.videoPlayer.muted = muted;
}

function setVolumeForAllMedia(value) {
  els.audioPlayer.volume = value;
  els.videoPlayer.volume = value;
}

function toggleMute() {
  const media = getActiveMediaElement();

  if (media.muted) {
    setMutedForAllMedia(false);
    setVolumeForAllMedia(state.volumeBeforeMute || 0.8);
    setStatus('已取消静音。', 'success');
  } else {
    state.volumeBeforeMute = media.volume || 0.8;
    setMutedForAllMedia(true);
    setStatus('已静音。', 'success');
  }

  renderPlayer();
}

function handleVolumeInput() {
  const value = Number(els.volumeRange.value) / 100;
  const media = getActiveMediaElement();

  if (value <= 0) {
    if (!media.muted) {
      state.volumeBeforeMute = media.volume || state.volumeBeforeMute;
    }

    setVolumeForAllMedia(0);
    setMutedForAllMedia(true);
  } else {
    setVolumeForAllMedia(value);
    setMutedForAllMedia(false);
    state.volumeBeforeMute = value;
  }

  renderPlayer();
}

function handleSpeedChange() {
  setPlaybackRate(Number(els.speedSelect.value), { persist: true, announce: true });
}

function setPlaybackRate(rate, { persist = true, announce = false } = {}) {
  state.playbackRate = normalizePlaybackRate(rate);
  els.speedSelect.value = String(state.playbackRate);
  syncSharedMediaSettings();

  if (persist) {
    savePlaybackRate(state.playbackRate);
  }

  renderPlayer();

  if (announce) {
    setStatus(`播放速度：${formatPlaybackRate(state.playbackRate)}`, 'success');
  }
}

function handleSeek() {
  const track = getCurrentTrack();
  if (!track) {
    return;
  }

  const media = getActiveMediaElement(track);
  const durationValue = Number.isFinite(media.duration) && media.duration > 0
    ? media.duration
    : Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 0;

  if (!durationValue) {
    return;
  }

  media.currentTime = (Number(els.progressRange.value) / 1000) * durationValue;
  updateProgressUI();
}

function handleLoadedMetadata(event) {
  const track = getCurrentTrack();
  const media = getActiveMediaElement(track);

  if (!track || event.target !== media) {
    return;
  }

  if (Number.isFinite(media.duration) && media.duration > 0) {
    const previousDuration = track.duration;
    track.duration = media.duration;
    if (track.duration !== previousDuration) {
      void persistTrack(track);
    }
  }

  renderLibrary();
  renderPlayer();
}

function handleTimeUpdate(event) {
  if (event.target !== getActiveMediaElement()) {
    return;
  }

  updateProgressUI();
}

function handleMediaPlay(event) {
  if (event.target !== getActiveMediaElement()) {
    return;
  }

  state.isPlaying = true;
  renderPlayer();
  renderLibrary();
}

function handleMediaPause(event) {
  if (event.target !== getActiveMediaElement()) {
    return;
  }

  state.isPlaying = false;
  renderPlayer();
  renderLibrary();
}

function handleMediaEnded(event) {
  const media = getActiveMediaElement();
  if (event.target !== media) {
    return;
  }

  if (state.repeatMode === 'one') {
    media.currentTime = 0;
    void media.play().catch(() => {});
    return;
  }

  playNext({ respectRepeat: true });
}

function handleMediaError(event) {
  if (event.target !== getActiveMediaElement()) {
    return;
  }

  const track = getCurrentTrack();
  if (track) {
    setStatus(`无法播放：${track.title}。可能是格式不受支持或链接没有跨域权限。`, 'error');
  } else {
    setStatus('当前媒体无法播放。', 'error');
  }
}

function handleTrackToggle(trackId) {
  const track = getTrackById(trackId);
  if (!track) {
    return;
  }

  if (state.currentId === trackId) {
    const media = getActiveMediaElement(track);
    if (state.isPlaying) {
      media.pause();
      return;
    }

    void media.play().catch((error) => {
      setStatus(`播放失败：${getErrorMessage(error, '请再点击一次播放按钮。')}`, 'error');
    });
    return;
  }

  void playTrack(trackId);
}

async function removeTrack(trackId) {
  const track = getTrackById(trackId);
  if (!track) {
    return;
  }

  void deletePersistedTrack(track.id).catch(() => {
    setStatus('本地删除失败，但当前列表已更新。', 'error');
  });

  const wasCurrent = state.currentId === trackId;
  const shouldContinue = wasCurrent && state.isPlaying;
  const orderedTracks = getPlaybackTracks();
  const currentIndex = orderedTracks.findIndex((item) => item.id === trackId);
  const nextCandidate = orderedTracks[currentIndex + 1] || orderedTracks[currentIndex - 1] || null;
  const media = getActiveMediaElement(track);

  if (track.objectUrl) {
    URL.revokeObjectURL(track.objectUrl);
  }

  state.history = state.history.filter((item) => item !== trackId);
  state.tracks = state.tracks.filter((item) => item.id !== trackId);

  if (wasCurrent) {
    state.currentId = null;
    state.isPlaying = false;
    media.pause();
    media.removeAttribute('src');
    media.load();

    if (shouldContinue && nextCandidate) {
      void playTrack(nextCandidate.id, { pushHistory: false });
      return;
    }
  }

  renderLibrary();
  renderPlayer();
  setStatus(state.tracks.length ? `已移除：${track.title}` : '列表已清空。', 'success');
}

async function persistTracks(tracks) {
  const results = await Promise.allSettled(tracks.map((track) => persistTrack(track)));
  return results.filter((result) => result.status === 'fulfilled' && result.value === true).length;
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []);
  const accepted = [];
  const rejected = [];

  for (const file of files) {
    if (getMediaTypeFromFile(file)) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  }

  if (!accepted.length) {
    setStatus('没有选到可播放的音频或视频文件。', 'error');
    return;
  }

  const tracks = accepted.map(createTrackFromFile);
  state.tracks = [...tracks, ...state.tracks];

  renderLibrary();
  renderPlayer();

  const hadCurrentTrack = Boolean(state.currentId);
  const savedCount = await persistTracks(tracks);

  tracks.forEach((track) => {
    void probeTrackDuration(track);
  });

  if (!state.currentId) {
    await playTrack(tracks[0].id, { pushHistory: false });
  }

  const failedCount = tracks.length - savedCount;
  const statusParts = [`已加入 ${accepted.length} 个媒体`];

  if (failedCount > 0) {
    statusParts.push(`其中 ${failedCount} 个未写入本地存储`);
  } else {
    statusParts.push('并保存在本地浏览器');
  }

  if (rejected.length > 0) {
    statusParts.push(`忽略 ${rejected.length} 个不支持的文件`);
  }

  if (hadCurrentTrack || failedCount > 0 || rejected.length > 0) {
    setStatus(`${statusParts.join('，')}。`, failedCount > 0 ? 'error' : 'success');
  }
}

async function handleFileInputChange() {
  const files = Array.from(els.audioInput.files || []);
  els.audioInput.value = '';

  if (!files.length) {
    return;
  }

  await importFiles(files);
}

function handlePickFiles() {
  els.audioInput.click();
}

function handleDropzoneDragOver(event) {
  event.preventDefault();
  els.dropzone.classList.add('is-dragover');
}

function handleDropzoneDragLeave(event) {
  event.preventDefault();
  els.dropzone.classList.remove('is-dragover');
}

function handleDropzoneDrop(event) {
  event.preventDefault();
  els.dropzone.classList.remove('is-dragover');

  const files = event.dataTransfer?.files;
  if (files && files.length) {
    void importFiles(files);
  }
}

async function handleLinkSubmit(event) {
  event.preventDefault();

  const url = els.trackUrl.value.trim();
  const title = els.trackTitle.value.trim();
  const artist = els.trackArtist.value.trim();

  if (!isValidHttpUrl(url)) {
    setStatus('请输入有效的 http(s) 音频或视频链接。', 'error');
    return;
  }

  const hadCurrentTrack = Boolean(state.currentId);
  const track = createTrackFromUrl(url, title, artist);
  state.tracks = [track, ...state.tracks];

  renderLibrary();
  renderPlayer();

  const saved = await persistTrack(track);
  void probeTrackDuration(track);

  els.linkForm.reset();

  if (!state.currentId) {
    await playTrack(track.id, { pushHistory: false });
  }

  if (hadCurrentTrack || !saved) {
    setStatus(saved ? `已加入链接：${track.title}，并保存在本地浏览器。` : `已加入链接：${track.title}，但未能写入本地存储。`, saved ? 'success' : 'error');
  }
}

async function restorePersistedLibrary() {
  const tracks = await loadStoredTracks();
  state.tracks = tracks;
  renderLibrary();
  renderPlayer();

  if (tracks.length) {
    setStatus(`已从本地浏览器恢复 ${tracks.length} 个媒体。`, 'success');
  } else if (storageAvailable) {
    setStatus('准备就绪，等待导入音频或视频；导入后会保存在本地浏览器。', 'info');
  } else {
    setStatus('本地存储不可用，导入的音频或视频只能临时保留。', 'error');
  }
}

function cleanupObjectUrls() {
  for (const track of state.tracks) {
    if (track.objectUrl) {
      URL.revokeObjectURL(track.objectUrl);
    }
  }
}

function bindMediaEvents(media) {
  media.addEventListener('loadedmetadata', handleLoadedMetadata);
  media.addEventListener('timeupdate', handleTimeUpdate);
  media.addEventListener('play', handleMediaPlay);
  media.addEventListener('pause', handleMediaPause);
  media.addEventListener('ended', handleMediaEnded);
  media.addEventListener('error', handleMediaError);
  media.addEventListener('volumechange', syncVolumeUI);
}

function bindEvents() {
  els.pickFilesButton.addEventListener('click', handlePickFiles);
  els.audioInput.addEventListener('change', () => {
    void handleFileInputChange();
  });
  els.linkForm.addEventListener('submit', (event) => {
    void handleLinkSubmit(event);
  });
  els.searchInput.addEventListener('input', renderLibrary);
  els.sortSelect.addEventListener('change', renderLibrary);
  els.speedSelect.addEventListener('change', handleSpeedChange);
  els.playButton.addEventListener('click', () => {
    void togglePlay();
  });
  els.prevButton.addEventListener('click', playPrevious);
  els.nextButton.addEventListener('click', () => playNext());
  els.shuffleButton.addEventListener('click', toggleShuffle);
  els.repeatButton.addEventListener('click', cycleRepeatMode);
  els.progressRange.addEventListener('input', handleSeek);
  els.volumeRange.addEventListener('input', handleVolumeInput);
  els.muteButton.addEventListener('click', toggleMute);
  els.dropzone.addEventListener('dragover', handleDropzoneDragOver);
  els.dropzone.addEventListener('dragleave', handleDropzoneDragLeave);
  els.dropzone.addEventListener('drop', handleDropzoneDrop);

  bindMediaEvents(els.audioPlayer);
  bindMediaEvents(els.videoPlayer);

  window.addEventListener('beforeunload', cleanupObjectUrls);
}

async function init() {
  bindEvents();
  setPlaybackRate(loadPlaybackRate(), { persist: false });
  await restorePersistedLibrary();

  if (!state.tracks.length) {
    renderPlayer();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  }, { once: true });
} else {
  void init();
}

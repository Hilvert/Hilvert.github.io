'use strict';

const $ = (selector) => document.querySelector(selector);

const els = {
  audioInput: $('#audio-input'),
  audioPlayer: $('#audio-player'),
  dropzone: $('#dropzone'),
  pickFilesButton: $('#pick-files-button'),
  linkForm: $('#link-form'),
  trackUrl: $('#track-url'),
  trackTitle: $('#track-title'),
  trackArtist: $('#track-artist'),
  statusBanner: $('#status-banner'),
  searchInput: $('#search-input'),
  sortSelect: $('#sort-select'),
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

const state = {
  tracks: [],
  currentId: null,
  isPlaying: false,
  shuffle: false,
  repeatMode: 'all',
  history: [],
  volumeBeforeMute: 0.8
};

els.audioPlayer.volume = state.volumeBeforeMute;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function isAudioFile(file) {
  return Boolean(
    file && (
      (typeof file.type === 'string' && file.type.startsWith('audio/')) ||
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.name)
    )
  );
}

function inferTitleFromName(name) {
  const withoutExt = name.replace(/\.[^.]+$/, '');
  const normalized = normalizeText(withoutExt.replace(/[_-]+/g, ' '));
  return normalized || '未命名歌曲';
}

function inferTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return inferTitleFromName(decodeURIComponent(fileName || '外部音频'));
  } catch {
    return '外部音频';
  }
}

function inferFormatFromName(name, mime = '') {
  const extension = name.includes('.') ? name.split('.').pop() : '';
  if (extension) {
    return extension.toUpperCase();
  }
  if (mime && mime.includes('/')) {
    const subtype = mime.split('/')[1];
    return subtype ? subtype.toUpperCase() : 'AUDIO';
  }
  return 'AUDIO';
}

function inferFormatFromUrl(url) {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() || '';
    return inferFormatFromName(fileName || 'audio', '');
  } catch {
    return 'AUDIO';
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

function sourceLabel(track) {
  return track.sourceType === 'file' ? '本地文件' : '音频链接';
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

function formatDate(value) {
  if (!value) {
    return '暂无';
  }

  return new Date(value).toLocaleString('zh-CN', { hour12: false });
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

function getTrackById(trackId) {
  return state.tracks.find((track) => track.id === trackId) || null;
}

function getCurrentTrack() {
  return state.currentId ? getTrackById(state.currentId) : null;
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
  els.volumeRange.value = els.audioPlayer.muted ? '0' : String(Math.round(els.audioPlayer.volume * 100));
}

function updateProgressUI() {
  const track = getCurrentTrack();

  if (!track) {
    els.currentTime.textContent = '0:00';
    els.duration.textContent = '0:00';
    els.progressRange.value = '0';
    return;
  }

  const durationValue = Number.isFinite(els.audioPlayer.duration) && els.audioPlayer.duration > 0
    ? els.audioPlayer.duration
    : Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 0;

  els.currentTime.textContent = formatDuration(els.audioPlayer.currentTime);
  els.duration.textContent = durationValue ? formatDuration(durationValue) : '--:--';
  els.progressRange.value = durationValue ? String(Math.round((els.audioPlayer.currentTime / durationValue) * 1000)) : '0';
}

function renderPlayer() {
  const track = getCurrentTrack();

  if (state.currentId && !track) {
    state.currentId = null;
  }

  const activeTrack = getCurrentTrack();
  const hasTrack = Boolean(activeTrack);
  const playing = hasTrack && state.isPlaying;
  const repeatLabels = {
    off: '循环：关',
    all: '循环：列',
    one: '循环：单'
  };

  els.playerCard.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-playing', playing);

  els.currentSource.textContent = hasTrack ? sourceLabel(activeTrack) : '等待导入';
  els.currentTitle.textContent = hasTrack ? activeTrack.title : '尚未选择歌曲';
  els.currentArtist.textContent = hasTrack ? buildTrackDetail(activeTrack, { includeDuration: true }) : '导入一首歌曲开始播放。';

  els.heroCurrentTrack.textContent = hasTrack ? activeTrack.title : '尚未选择歌曲';
  els.heroCurrentMeta.textContent = hasTrack
    ? `${playing ? '播放中' : '已暂停'} · ${buildTrackDetail(activeTrack, { includeDuration: true })}`
    : '导入一首歌后就会显示在这里。';

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

  els.muteButton.textContent = els.audioPlayer.muted ? '取消静音' : '静音';
  els.muteButton.classList.toggle('is-active', els.audioPlayer.muted);
  els.muteButton.setAttribute('aria-pressed', String(els.audioPlayer.muted));

  const durationValue = hasTrack && Number.isFinite(els.audioPlayer.duration) && els.audioPlayer.duration > 0
    ? els.audioPlayer.duration
    : hasTrack && Number.isFinite(activeTrack.duration) && activeTrack.duration > 0
      ? activeTrack.duration
      : 0;

  const seekEnabled = hasTrack && durationValue > 0;
  els.progressRange.disabled = !seekEnabled;
  els.progressRange.value = seekEnabled ? String(Math.round((els.audioPlayer.currentTime / durationValue) * 1000)) : '0';
  els.currentTime.textContent = hasTrack ? formatDuration(els.audioPlayer.currentTime) : '0:00';
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
  els.heroTrackCount.textContent = `${total} 首`;

  if (!list.length) {
    const emptyMessage = total
      ? '没有匹配到歌曲，换个关键词试试。'
      : '尚未导入任何歌曲。先拖入一个音频文件，或者贴一个可播放的音频链接。';

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
    fragment.querySelector('.format-chip').textContent = track.format || 'AUDIO';

    toggleButton.textContent = isCurrent ? (isPlaying ? '暂停' : '继续') : '播放';
    toggleButton.classList.toggle('is-active', isCurrent);
    toggleButton.setAttribute('aria-label', `${toggleButton.textContent} ${track.title}`);
    toggleButton.addEventListener('click', () => {
      void handleTrackToggle(track.id);
    });

    removeButton.setAttribute('aria-label', `移除 ${track.title}`);
    removeButton.addEventListener('click', () => {
      removeTrack(track.id);
    });

    els.playlist.append(fragment);
  });
}

function createTrackFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const name = file.name || '未命名歌曲';

  return {
    id: createId(),
    title: inferTitleFromName(name),
    artist: '',
    sourceType: 'file',
    src: objectUrl,
    objectUrl,
    fileName: name,
    size: file.size,
    duration: null,
    format: inferFormatFromName(name, file.type),
    addedAt: Date.now()
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
    src: url,
    objectUrl: null,
    fileName: inferredTitle,
    size: null,
    duration: null,
    format: inferFormatFromUrl(url),
    addedAt: Date.now()
  };
}

async function probeTrackDuration(track) {
  const probe = document.createElement('audio');
  probe.preload = 'metadata';

  return new Promise((resolve) => {
    const finish = (duration) => {
      probe.src = '';
      resolve(duration);
    };

    probe.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(probe.duration) ? probe.duration : null);
    }, { once: true });

    probe.addEventListener('error', () => {
      finish(null);
    }, { once: true });

    probe.src = track.src;
  }).then((duration) => {
    const current = getTrackById(track.id);
    if (!current) {
      return duration;
    }

    current.duration = Number.isFinite(duration) ? duration : current.duration;

    if (state.currentId === current.id) {
      renderPlayer();
    }

    renderLibrary();
    return duration;
  });
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

  if (els.audioPlayer.src !== track.src) {
    els.audioPlayer.src = track.src;
    els.audioPlayer.load();
  }

  renderPlayer();
  renderLibrary();

  try {
    await els.audioPlayer.play();
    if (announce) {
      setStatus(`正在播放：${track.title}`, 'success');
    }
  } catch (error) {
    state.isPlaying = false;
    renderPlayer();
    setStatus(`播放失败：${getErrorMessage(error, '请检查音频链接或文件格式。')}`, 'error');
  }
}

async function togglePlay() {
  const current = getCurrentTrack();

  if (!current) {
    const firstTrack = getPlaybackTracks()[0];
    if (!firstTrack) {
      setStatus('当前没有可播放的歌曲。', 'error');
      return;
    }

    await playTrack(firstTrack.id);
    return;
  }

  if (state.isPlaying) {
    els.audioPlayer.pause();
    return;
  }

  try {
    await els.audioPlayer.play();
  } catch (error) {
    setStatus(`播放失败：${getErrorMessage(error, '请再点击一次播放按钮。')}`, 'error');
  }
}

function playNext({ respectRepeat = false } = {}) {
  const list = getPlaybackTracks();
  if (!list.length) {
    setStatus('当前没有可播放的歌曲。', 'error');
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
      setStatus('已经播放到最后一首。', 'info');
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
    setStatus('当前没有可播放的歌曲。', 'error');
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
      setStatus('已经是第一首了。', 'info');
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
    one: '单曲循环'
  };

  const nextIndex = (order.indexOf(state.repeatMode) + 1) % order.length;
  state.repeatMode = order[nextIndex];
  renderPlayer();
  setStatus(`播放模式：${labels[state.repeatMode]}`, 'success');
}

function toggleMute() {
  if (els.audioPlayer.muted) {
    els.audioPlayer.muted = false;
    els.audioPlayer.volume = state.volumeBeforeMute || 0.8;
    setStatus('已取消静音。', 'success');
  } else {
    state.volumeBeforeMute = els.audioPlayer.volume || 0.8;
    els.audioPlayer.muted = true;
    setStatus('已静音。', 'success');
  }

  renderPlayer();
}

function handleVolumeInput() {
  const value = Number(els.volumeRange.value) / 100;

  if (value <= 0) {
    if (!els.audioPlayer.muted) {
      state.volumeBeforeMute = els.audioPlayer.volume || state.volumeBeforeMute;
    }

    els.audioPlayer.volume = 0;
    els.audioPlayer.muted = true;
  } else {
    els.audioPlayer.volume = value;
    els.audioPlayer.muted = false;
    state.volumeBeforeMute = value;
  }

  renderPlayer();
}

function handleSeek() {
  const track = getCurrentTrack();
  if (!track) {
    return;
  }

  const durationValue = Number.isFinite(els.audioPlayer.duration) && els.audioPlayer.duration > 0
    ? els.audioPlayer.duration
    : Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 0;

  if (!durationValue) {
    return;
  }

  els.audioPlayer.currentTime = (Number(els.progressRange.value) / 1000) * durationValue;
  updateProgressUI();
}

function handleLoadedMetadata() {
  const track = getCurrentTrack();
  if (track && Number.isFinite(els.audioPlayer.duration) && els.audioPlayer.duration > 0) {
    track.duration = els.audioPlayer.duration;
  }

  renderLibrary();
  renderPlayer();
}

function handleTimeUpdate() {
  updateProgressUI();
}

function handleAudioPlay() {
  state.isPlaying = true;
  renderPlayer();
  renderLibrary();
}

function handleAudioPause() {
  state.isPlaying = false;
  renderPlayer();
  renderLibrary();
}

function handleAudioEnded() {
  if (state.repeatMode === 'one') {
    els.audioPlayer.currentTime = 0;
    void els.audioPlayer.play().catch(() => {});
    return;
  }

  playNext({ respectRepeat: true });
}

function handleAudioError() {
  const track = getCurrentTrack();
  if (track) {
    setStatus(`无法播放：${track.title}。可能是格式不受支持或链接没有跨域权限。`, 'error');
  } else {
    setStatus('当前音频无法播放。', 'error');
  }
}

function handleTrackToggle(trackId) {
  const track = getTrackById(trackId);
  if (!track) {
    return;
  }

  if (state.currentId === trackId) {
    if (state.isPlaying) {
      els.audioPlayer.pause();
      return;
    }

    void els.audioPlayer.play().catch((error) => {
      setStatus(`播放失败：${getErrorMessage(error, '请再点击一次播放按钮。')}`, 'error');
    });
    return;
  }

  void playTrack(trackId);
}

function removeTrack(trackId) {
  const track = getTrackById(trackId);
  if (!track) {
    return;
  }

  const wasCurrent = state.currentId === trackId;
  const shouldContinue = wasCurrent && state.isPlaying;
  const orderedTracks = getPlaybackTracks();
  const currentIndex = orderedTracks.findIndex((item) => item.id === trackId);
  const nextCandidate = orderedTracks[currentIndex + 1] || orderedTracks[currentIndex - 1] || null;

  if (track.objectUrl) {
    URL.revokeObjectURL(track.objectUrl);
  }

  state.history = state.history.filter((item) => item !== trackId);
  state.tracks = state.tracks.filter((item) => item.id !== trackId);

  if (wasCurrent) {
    state.currentId = null;
    state.isPlaying = false;
    els.audioPlayer.pause();
    els.audioPlayer.removeAttribute('src');
    els.audioPlayer.load();

    if (shouldContinue && nextCandidate) {
      void playTrack(nextCandidate.id, { pushHistory: false });
      return;
    }
  }

  renderLibrary();
  renderPlayer();
  setStatus(state.tracks.length ? `已移除：${track.title}` : '歌单已清空。', 'success');
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []);
  const accepted = [];
  const rejected = [];

  for (const file of files) {
    if (isAudioFile(file)) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  }

  if (!accepted.length) {
    setStatus('没有选到可播放的音频文件。', 'error');
    return;
  }

  const tracks = accepted.map(createTrackFromFile);
  state.tracks = [...tracks, ...state.tracks];

  renderLibrary();
  renderPlayer();

  tracks.forEach((track) => {
    void probeTrackDuration(track);
  });

  if (!state.currentId) {
    await playTrack(tracks[0].id, { pushHistory: false });
    return;
  }

  if (rejected.length) {
    setStatus(`已加入 ${accepted.length} 首音乐，忽略 ${rejected.length} 个非音频文件。`, 'success');
  } else {
    setStatus(`已加入 ${accepted.length} 首音乐。`, 'success');
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
    setStatus('请输入有效的 http(s) 音频链接。', 'error');
    return;
  }

  const track = createTrackFromUrl(url, title, artist);
  state.tracks = [track, ...state.tracks];

  renderLibrary();
  renderPlayer();
  void probeTrackDuration(track);

  els.linkForm.reset();

  if (!state.currentId) {
    await playTrack(track.id, { pushHistory: false });
    return;
  }

  setStatus(`已加入链接：${track.title}`, 'success');
}

function cleanupObjectUrls() {
  for (const track of state.tracks) {
    if (track.objectUrl) {
      URL.revokeObjectURL(track.objectUrl);
    }
  }
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

  els.audioPlayer.addEventListener('loadedmetadata', handleLoadedMetadata);
  els.audioPlayer.addEventListener('timeupdate', handleTimeUpdate);
  els.audioPlayer.addEventListener('play', handleAudioPlay);
  els.audioPlayer.addEventListener('pause', handleAudioPause);
  els.audioPlayer.addEventListener('ended', handleAudioEnded);
  els.audioPlayer.addEventListener('error', handleAudioError);
  els.audioPlayer.addEventListener('volumechange', syncVolumeUI);

  window.addEventListener('beforeunload', cleanupObjectUrls);
}

function init() {
  bindEvents();
  renderLibrary();
  renderPlayer();
  setStatus('准备就绪，等待导入音乐。', 'info');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

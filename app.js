        let allSongs = [];
        let filteredSongs = [];
        let setlist = [];
        let draggedSongData = null;
        let draggedFromTable = null;
        let activeKeyFilters = new Set();
        let keyCounts = {};
        let buildDirection = 'after';
        let previewAudio = null;
        let previewButton = null;
        let previewSrc = '';
        let previewLookupInFlight = false;
        let previewLookupDone = false;
        let previewLookupError = '';
        let previewCache = {};
        let harTrackCache = {};
        const LIBRARY_RENDER_LIMIT = 300;
        const SUGGESTION_RENDER_LIMIT = 80;
        try { previewCache = JSON.parse(localStorage.getItem('spotifyPreviewCache') || '{}') || {}; } catch (e) { previewCache = {}; }
        const SPOTIFY_ICON_SRC = './spotify-logo.png';

        const A_KEYS = ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'];
        const B_KEYS = ['1B','2B','3B','4B','5B','6B','7B','8B','9B','10B','11B','12B'];
        const ALL_KEYS = [...A_KEYS, ...B_KEYS];

        buildKeySlicer();
        initResizeHandle();
        initDragGuard();
        initTrackActionDelegation();

        window.addEventListener('load', async () => {
            await loadHarTrackCache();
            const stored = localStorage.getItem('djLibrary');
            if (stored) {
                allSongs = JSON.parse(stored);
                enrichAllSongsForFastFiltering();
                populateFilterDropdowns();
                computeKeyCounts();
                updateKeyButtons();
                hydrateSongsFromHarCache({ rerender: false });
                applyFilters();
                showNotification(`Loaded ${allSongs.length} tracks`, 'success');
            }
        });

        /* ── DRAG GUARD ── */
        let _isDragging = false;
        let _dragEndTimeout = null;

        function initDragGuard() {
            document.addEventListener('dragstart', () => { _isDragging = true; clearTimeout(_dragEndTimeout); });
            document.addEventListener('dragend',   () => { _dragEndTimeout = setTimeout(() => { _isDragging = false; }, 300); });
            document.addEventListener('drop',      () => { _dragEndTimeout = setTimeout(() => { _isDragging = false; }, 300); });
        }

        /* ── RESIZE HANDLE ── */
        function initResizeHandle() {
            const handle = document.getElementById('resizeHandle');
            const body   = document.querySelector('.library-body');
            const wrap   = document.getElementById('suggestionsWrap');
            let dragging = false, startY = 0, startH = 0;

            function setSuggestionsHeight(px) {
                const maxH = Math.min(window.innerHeight * 0.55, Math.max(120, body.getBoundingClientRect().height - 250));
                const newH = Math.max(70, Math.min(px, maxH));
                body.style.setProperty('--suggestions-h', `${newH}px`);
            }

            function startDrag(clientY) {
                dragging = true;
                startY = clientY;
                startH = wrap.getBoundingClientRect().height;
                handle.classList.add('dragging');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
            }

            function endDrag() {
                if (!dragging) return;
                dragging = false;
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }

            handle.addEventListener('mousedown', e => { startDrag(e.clientY); e.preventDefault(); });
            document.addEventListener('mousemove', e => { if (dragging) setSuggestionsHeight(startH + (e.clientY - startY)); });
            document.addEventListener('mouseup', endDrag);
            handle.addEventListener('touchstart', e => { startDrag(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
            document.addEventListener('touchmove', e => { if (dragging) setSuggestionsHeight(startH + (e.touches[0].clientY - startY)); }, { passive: true });
            document.addEventListener('touchend', endDrag);
        }

        /* ── KEY SLICER ── */
        function buildKeySlicer() {
            document.getElementById('rowA').innerHTML = A_KEYS.map(k => keyBtnHTML(k, 'minor')).join('');
            document.getElementById('rowB').innerHTML = B_KEYS.map(k => keyBtnHTML(k, 'major')).join('');
        }
        function keyBtnHTML(key, cls) {
            return `<button class="key-btn ${cls}" data-key="${key}" onclick="toggleKeyFilter('${key}')">
                <span class="key-btn-label">${key}</span>
                <span class="key-btn-count" id="kc-${key}">—</span>
            </button>`;
        }
        function computeKeyCounts() {
            keyCounts = {};
            ALL_KEYS.forEach(k => keyCounts[k] = 0);
            allSongs.forEach(s => {
                const k = s.Camelot || s['Camelot Key'] || s.camelot || '';
                if (k && keyCounts[k] !== undefined) keyCounts[k]++;
            });
        }
        function updateKeyButtons() {
            ALL_KEYS.forEach(key => {
                const btn     = document.querySelector(`.key-btn[data-key="${key}"]`);
                const countEl = document.getElementById(`kc-${key}`);
                if (!btn || !countEl) return;
                const n = keyCounts[key] || 0;
                countEl.textContent = n > 0 ? n : '—';
                btn.classList.toggle('unavailable', n === 0);
                btn.classList.toggle('active', activeKeyFilters.has(key));
            });
            document.getElementById('keySlicerClear').classList.toggle('visible', activeKeyFilters.size > 0);
        }

        /* ── CSV UPLOAD ── */
        document.getElementById('csvUpload').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                const text      = ev.target.result;
                const firstLine = text.split('\n')[0];
                const delimiter = firstLine.includes('\t') ? '\t' : ',';
                const lines     = text.split('\n').filter(l => l.trim());
                const rows      = lines.map(l => parseCSVLine(l, delimiter));
                if (rows.length < 2) { showNotification('CSV file is empty or invalid', 'error'); return; }
                const headers = rows[0].map(h => h.trim());
                allSongs = rows.slice(1)
                    .filter(row => row.length >= headers.length / 2)
                    .map(row => {
                        const song = {};
                        headers.forEach((h, i) => { song[h] = row[i] ? row[i].trim() : ''; });
                        return song;
                    });
                if (allSongs.length === 0) { showNotification('No valid songs found in CSV', 'error'); return; }
                enrichAllSongsForFastFiltering();
                localStorage.setItem('djLibrary', JSON.stringify(allSongs));
                populateFilterDropdowns();
                computeKeyCounts();
                updateKeyButtons();
                hydrateSongsFromHarCache({ rerender: false });
                applyFilters();
                showNotification(`Loaded ${allSongs.length} tracks`, 'success');
            };
            reader.readAsText(file);
        });

        function parseCSVLine(line, delimiter) {
            const result = [];
            let current = '', inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i], next = line[i + 1];
                if (char === '"') {
                    if (inQuotes && next === '"') { current += '"'; i++; }
                    else { inQuotes = !inQuotes; }
                } else if (char === delimiter && !inQuotes) {
                    result.push(current); current = '';
                } else { current += char; }
            }
            result.push(current);
            return result;
        }

        function splitAndNormalize(raw) {
            if (!raw) return [];
            return raw.split(',').map(s => s.trim()).filter(Boolean);
        }

        function populateFilterDropdowns() {
            const artistSet = new Set(), genreSet = new Set();
            allSongs.forEach(s => {
                splitAndNormalize(s.Artist || s['Artist Name(s)'] || s.artist || '').forEach(a => artistSet.add(a));
                splitAndNormalize(s.Genres || s.genres || s.Genre || '').forEach(g => genreSet.add(g));
            });
            const af = document.getElementById('artistFilter');
            af.innerHTML = '<option value="">All Artists</option>';
            [...artistSet].sort((a,b) => a.localeCompare(b)).forEach(a => { af.innerHTML += `<option value="${escAttr(a)}">${esc(a)}</option>`; });
            const gf = document.getElementById('genreFilter');
            gf.innerHTML = '<option value="">All Genres</option>';
            [...genreSet].sort((a,b) => a.localeCompare(b)).forEach(g => { gf.innerHTML += `<option value="${escAttr(g)}">${esc(g)}</option>`; });
        }

        function esc(s)     { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        function escAttr(s) { return String(s || '').replace(/"/g,'&quot;'); }
        function jsString(s) { return JSON.stringify(String(s || '')); }

        function getTrackId(song) {
            const raw = song['Spotify Track Id'] || song['Spotify Track ID'] || song['Spotify TrackId'] || song['Track ID'] || song.track_id || song.spotify_track_id || song.spotifyTrackId || song.trackId || '';
            return normalizeSpotifyId(raw, 'track');
        }

        function getAlbumId(song) {
            const raw = song['Spotify Album Id'] || song['Spotify Album ID'] || song['Album ID'] || song['Album Id'] || song.album_id || song.spotify_album_id || song.spotifyAlbumId || song.albumId || song['Album URI'] || song['Spotify Album URI'] || '';
            return normalizeSpotifyId(raw, 'album');
        }

        function normalizeSpotifyId(value, type) {
            const text = String(value || '').trim();
            if (!text) return '';
            const uriMatch = text.match(new RegExp(`spotify:${type}:([A-Za-z0-9]+)`));
            if (uriMatch) return uriMatch[1];
            const urlMatch = text.match(new RegExp(`open\\.spotify\\.com/${type}/([A-Za-z0-9]+)`));
            if (urlMatch) return urlMatch[1];
            const bareMatch = text.match(/[A-Za-z0-9]{22}/);
            return bareMatch ? bareMatch[0] : text;
        }

        async function loadHarTrackCache() {
            try {
                const res = await fetch('./spotify-har-cache.json', { cache: 'force-cache' });
                if (!res.ok) throw new Error(`HAR cache ${res.status}`);
                harTrackCache = await res.json();
            } catch (err) {
                console.warn('Local HAR Spotify cache unavailable:', err);
                harTrackCache = {};
            }
        }

        function getHarTrackInfo(songOrTrackId) {
            const trackId = typeof songOrTrackId === 'string' ? normalizeSpotifyId(songOrTrackId, 'track') : getTrackId(songOrTrackId);
            return trackId && harTrackCache && harTrackCache[trackId] ? harTrackCache[trackId] : null;
        }

        function hydrateSongsFromHarCache(options = {}) {
            let changed = false;
            allSongs.forEach(song => {
                const info = getHarTrackInfo(song);
                if (!info) return;
                if (info.preview && !previewCache[getTrackId(song)]) {
                    previewCache[getTrackId(song)] = info.preview;
                    changed = true;
                }
            });
            if (changed) localStorage.setItem('spotifyPreviewCache', JSON.stringify(previewCache));
            if (options.rerender !== false) renderPreviewDependentUI();
        }

        function getAlbumImage(song) {
            const directFields = [
                'Album Image URL', 'Album Image Url', 'Album Art URL', 'Album Art Url', 'Artwork URL', 'Artwork Url',
                'Image URL', 'Image Url', 'Cover URL', 'Cover Url', 'album_image_url', 'albumArtUrl', 'imageUrl'
            ];
            for (const field of directFields) {
                const value = song[field];
                if (value && String(value).trim()) return String(value).trim();
            }
            for (const value of Object.values(song)) {
                const text = String(value || '').trim();
                const match = text.match(/https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+/);
                if (match) return match[0];
            }
            const info = getHarTrackInfo(song);
            return info && info.image ? info.image : '';
        }

        function getPreviewUrl(song) {
            const directFields = [
                'Preview URL', 'Preview Url', 'Preview url', 'preview_url', 'previewUrl', 'preview url',
                'Spotify Preview URL', 'Spotify Preview Url', 'Track Preview URL', 'Audio Preview URL',
                'Sample URL', 'Sample Url', 'sample_url', 'Sample', 'Preview'
            ];
            for (const field of directFields) {
                const value = song[field];
                if (value && String(value).trim()) return String(value).trim();
            }
            for (const value of Object.values(song)) {
                const text = String(value || '').trim();
                const match = text.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[^\s"']+/);
                if (match) return match[0];
            }
            const trackId = getTrackId(song);
            if (trackId && previewCache[trackId]) return previewCache[trackId];
            const info = getHarTrackInfo(song);
            return info && info.preview ? info.preview : '';
        }

        function getSongsMissingPreview() {
            return allSongs.filter(song => {
                const trackId = getTrackId(song);
                return trackId && !getPreviewUrl(song);
            });
        }

        function uniqueChunks(values, size) {
            const unique = [...new Set(values.filter(Boolean))];
            const chunks = [];
            for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
            return chunks;
        }

        async function lookupSpotifyPreviews(options = {}) {
            // Live Spotify Web API lookups require Authorization and create slow/failed network work in Vercel.
            // StageDeck now relies on spotify-har-cache.json and any preview URLs supplied in the CSV.
            hydrateSongsFromHarCache();
        }

        function renderPreviewDependentUI() {
            renderLibrary();
            renderSetlist();
            if (setlist.length > 0) updateNowPlaying(setlist[setlist.length - 1]);
            updateSuggestions();
        }

        function spotifyActionHTML(trackId, mini = false) {
            const id = normalizeSpotifyId(trackId, 'track');
            const disabled = !id ? 'disabled' : '';
            return `<button class="track-action-btn spotify-logo-btn ${mini ? 'mini' : ''}" ${disabled} type="button" title="Open in Spotify" data-action="spotify" data-track-id="${escAttr(id)}"><img src="${SPOTIFY_ICON_SRC}" alt="Spotify" loading="lazy" decoding="async"></button>`;
        }

        function sampleActionHTML(previewUrl, mini = false) {
            const url = String(previewUrl || '').trim();
            const disabled = !url ? 'disabled' : '';
            const title = url ? 'Play 30 second sample' : 'No Spotify sample found in the HAR cache for this track';
            return `<button class="track-action-btn sample-btn ${mini ? 'mini' : ''}" ${disabled} type="button" title="${escAttr(title)}" data-action="sample" data-preview-url="${escAttr(url)}"></button>`;
        }

        function initTrackActionDelegation() {
            document.addEventListener('click', event => {
                const btn = event.target.closest('[data-action]');
                if (!btn) return;

                const action = btn.dataset.action;
                if (action === 'spotify') {
                    event.preventDefault();
                    event.stopPropagation();
                    openSpotify(btn.dataset.trackId || '', event);
                    return;
                }

                if (action === 'sample') {
                    event.preventDefault();
                    event.stopPropagation();
                    togglePreview(btn.dataset.previewUrl || '', btn, event);
                }
            }, { passive: false });
        }

        function togglePreview(url, btn, event) {
            if (event) event.stopPropagation();
            if (!url) { showNotification('No sample preview URL found for this track', 'error'); return; }

            if (previewAudio && previewSrc === url && !previewAudio.paused) {
                previewAudio.pause();
                previewAudio.currentTime = 0;
                if (previewButton) previewButton.classList.remove('playing');
                previewAudio = null;
                previewButton = null;
                previewSrc = '';
                return;
            }

            if (previewAudio) {
                previewAudio.pause();
                if (previewButton) previewButton.classList.remove('playing');
            }

            previewAudio = new Audio(url);
            previewSrc = url;
            previewButton = btn;
            btn.classList.add('playing');
            previewAudio.addEventListener('ended', () => {
                btn.classList.remove('playing');
                previewAudio = null;
                previewButton = null;
                previewSrc = '';
            });
            previewAudio.addEventListener('error', () => {
                btn.classList.remove('playing');
                showNotification('Could not load the song sample', 'error');
            });
            previewAudio.play().catch(() => {
                btn.classList.remove('playing');
                showNotification('Browser blocked or could not play this sample', 'error');
            });
        }

        function toggleKeyFilter(key) {
            if (_isDragging) return;
            if (keyCounts[key] === 0) return;
            if (activeKeyFilters.has(key)) activeKeyFilters.delete(key);
            else activeKeyFilters.add(key);
            updateKeyButtons();
            applyFilters();
        }
        function clearKeyFilter() {
            activeKeyFilters.clear();
            updateKeyButtons();
            applyFilters();
        }

        let filterDebounceTimer = null;
        const FILTER_DEBOUNCE_MS = 170;

        function defineFastProp(obj, key, value) {
            try { Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false }); }
            catch (e) { obj[key] = value; }
        }

        function enrichSongForFastFiltering(song) {
            const songName  = song.Song || song['Track Name'] || song.song || '';
            const artistRaw = song.Artist || song['Artist Name(s)'] || song.artist || '';
            const albumName = song.Album || song['Album Name'] || song.album || '';
            const genreRaw  = song.Genres || song.genres || song.Genre || '';
            const camelot   = song.Camelot || song['Camelot Key'] || song.camelot || '';
            const bpm       = song.BPM || song.bpm || '';
            defineFastProp(song, '__searchBlob', `${songName} ${artistRaw} ${albumName}`.toLowerCase());
            defineFastProp(song, '__artistList', splitAndNormalize(artistRaw));
            defineFastProp(song, '__genreList', splitAndNormalize(genreRaw));
            defineFastProp(song, '__camelot', camelot);
            defineFastProp(song, '__hasKnownBasics', !!(camelot && bpm && bpm !== '0'));
            return song;
        }

        function enrichAllSongsForFastFiltering() {
            allSongs.forEach(enrichSongForFastFiltering);
        }

        function scheduleApplyFilters() {
            clearTimeout(filterDebounceTimer);
            filterDebounceTimer = setTimeout(applyFilters, FILTER_DEBOUNCE_MS);
        }

        function applyFilters() {
            clearTimeout(filterDebounceTimer);
            const search      = document.getElementById('searchInput').value.trim().toLowerCase();
            const artist      = document.getElementById('artistFilter').value;
            const genre       = document.getElementById('genreFilter').value;
            const showUnknown = document.getElementById('showUnknown').checked;
            const keyFiltering = activeKeyFilters.size > 0;
            filteredSongs = allSongs.filter(song => {
                if (!song.__searchBlob) enrichSongForFastFiltering(song);
                if (search && !song.__searchBlob.includes(search)) return false;
                if (artist && !song.__artistList.includes(artist)) return false;
                if (genre  && !song.__genreList.includes(genre)) return false;
                if (!showUnknown && !song.__hasKnownBasics) return false;
                if (keyFiltering && !activeKeyFilters.has(song.__camelot)) return false;
                return true;
            });
            requestAnimationFrame(renderLibrary);
        }

        function renderLibrary() {
            const tbody = document.getElementById('libraryTable');
            document.getElementById('libraryCount').textContent = `${filteredSongs.length} tracks`;
            if (filteredSongs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">No songs match your filters</div></td></tr>';
                return;
            }
            const visibleSongs = filteredSongs.slice(0, LIBRARY_RENDER_LIMIT);
            const limitNotice = filteredSongs.length > LIBRARY_RENDER_LIMIT
                ? `<tr><td colspan="6"><div class="empty-state">Showing first ${LIBRARY_RENDER_LIMIT.toLocaleString()} of ${filteredSongs.length.toLocaleString()} matching tracks. Use search, artist, genre, or key filters to narrow the list.</div></td></tr>`
                : '';
            tbody.innerHTML = visibleSongs.map(song => {
                const songName   = song.Song || song['Track Name'] || 'Unknown';
                const artistName = song.Artist || song['Artist Name(s)'] || 'Unknown';
                const albumImage = getAlbumImage(song);
                const camelot    = song.Camelot || song['Camelot Key'] || '?';
                const bpm        = song.BPM || '?';
                const duration   = getSongDuration(song);
                const trackId    = getTrackId(song);
                const previewUrl = getPreviewUrl(song);
                return `
                <tr draggable="true" data-track-id="${escAttr(trackId)}" ondragstart="handleDragStart(event)">
                    <td class="track-action-cell">${spotifyActionHTML(trackId)}</td>
                    <td class="track-action-cell">${sampleActionHTML(previewUrl)}</td>
                    <td>
                        <div class="song-info">
                            <div class="album-art">${albumImage ? `<img src="${escAttr(albumImage)}" loading="lazy" decoding="async" alt="">` : '♪'}</div>
                            <div style="min-width:0;flex:1;">
                                <a class="song-title-link" href="#" onclick='openSpotifyWeb(${jsString(trackId)}); return false;'><div class="song-title" title="${escAttr(songName)}">${esc(songName)}</div></a>
                                <div class="song-artist" title="${escAttr(artistName)}">${esc(artistName)}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="key-badge">${esc(camelot)}</span></td>
                    <td><span class="bpm-badge">${esc(bpm)}</span></td>
                    <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">
                        ${formatDuration(duration)}
                        <span class="add-choice"><button class="add-mini-btn" title="Add before first track" onclick='addSongByTrackId(${jsString(trackId)}, "start")'>↑</button><button class="add-mini-btn" title="Add after last track" onclick='addSongByTrackId(${jsString(trackId)}, "end")'>↓</button></span>
                    </td>
                </tr>`;
            }).join('') + limitNotice;
        }

        function handleDragStart(e) {
            const row = e.target.closest('tr');
            if (!row) return;
            const trackId = row.dataset.trackId;
            draggedSongData = allSongs.find(s => getTrackId(s) === trackId) ||
                              setlist.find(s => getTrackId(s) === trackId);
            draggedFromTable = row.closest('tbody').id === 'libraryTable' ? 'library' :
                               row.closest('#suggestionsSection') ? 'library' : 'setlist';
        }

        function openSpotify(trackId, event) {
            if (event) event.stopPropagation();
            trackId = normalizeSpotifyId(trackId, 'track');
            if (!trackId || trackId === 'unknown') return;

            const appUrl = `spotify:track:${trackId}`;
            const webUrl = `https://open.spotify.com/track/${trackId}`;
            let pageWasHidden = false;

            const markHidden = () => {
                if (document.hidden) pageWasHidden = true;
            };
            document.addEventListener('visibilitychange', markHidden, { once: true });

            // Custom protocol links must happen directly inside the user click.
            const link = document.createElement('a');
            link.href = appUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();

            // If the app/protocol does not open, fall back to Spotify Web.
            window.setTimeout(() => {
                document.removeEventListener('visibilitychange', markHidden);
                if (!pageWasHidden && !document.hidden) window.open(webUrl, '_blank', 'noopener,noreferrer');
            }, 900);
        }
        function openSpotifyWeb(trackId) {
            if (trackId && trackId !== 'unknown' && trackId !== '')
                window.open(`https://open.spotify.com/track/${trackId}`, '_blank');
        }

        ['dropZoneTop', 'dropZoneBottom'].forEach(id => {
            const zone = document.getElementById(id);
            zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', e => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const position = zone.dataset.position === 'start' ? 'start' : 'end';
                if (draggedFromTable === 'library' && draggedSongData) addSongToSetlist(draggedSongData, position);
            });
        });

        function setBuildDirection(direction) {
            buildDirection = direction === 'before' ? 'before' : 'after';
            document.getElementById('directionBeforeBtn').classList.toggle('active', buildDirection === 'before');
            document.getElementById('directionAfterBtn').classList.toggle('active', buildDirection === 'after');
            updateSuggestions();
        }

        function addSongByTrackId(trackId, position) {
            const song = allSongs.find(s => getTrackId(s) === trackId);
            if (song) addSongToSetlist(song, position || (buildDirection === 'before' ? 'start' : 'end'));
        }

        function addSongToSetlist(song, position = 'end') {
            const songTrackId = getTrackId(song);
            const already = setlist.some(s => {
                const t = getTrackId(s);
                return t && songTrackId && t === songTrackId;
            });
            if (already) { showNotification('Already in setlist', 'error'); return; }

            const insertAtStart = position === 'start' || position === 'before';
            if (insertAtStart) setlist.unshift(song);
            else setlist.push(song);

            renderSetlist();
            updateNowPlaying(song, insertAtStart ? 'Added Before' : 'Added After');
            updateSuggestions();
            showNotification(insertAtStart ? 'Added before first track' : 'Added after last track', 'success');
        }

        /* ══════════════════════════════════════════
           TURNTABLE NOW-PLAYING ART
        ══════════════════════════════════════════ */
        function buildTurntableArt(albumImage) {
            const platContent = albumImage
                ? `<img src="${escAttr(albumImage)}" loading="lazy" decoding="async" alt="album art">`
                : `<div class="vinyl-platter-empty">♪</div>`;

            return `
            <div class="turntable-wrap">
                <!-- dark plinth ring -->
                <div class="turntable-plinth"></div>
                <!-- spinning platter (contains album art + overlays) -->
                <div class="vinyl-platter">
                    ${platContent}
                    <div class="vinyl-grooves"></div>
                    <div class="vinyl-sheen"></div>
                </div>
                <!-- center label (does NOT spin — it's a sibling, not a child of platter) -->
                <div class="vinyl-label"></div>
                <!-- SVG tonearm -->
                <svg class="vinyl-tonearm-svg" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <filter id="armglow" x="-60%" y="-60%" width="220%" height="220%">
                            <feGaussianBlur stdDeviation="2" result="blur"/>
                            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                        <linearGradient id="armGrad" x1="60" y1="8" x2="18" y2="58" gradientUnits="userSpaceOnUse">
                            <stop offset="0%" stop-color="rgba(220,222,240,0.85)"/>
                            <stop offset="100%" stop-color="rgba(160,162,190,0.55)"/>
                        </linearGradient>
                    </defs>
                    <!-- main arm shaft -->
                    <line x1="60" y1="8" x2="20" y2="56"
                          stroke="url(#armGrad)" stroke-width="2.8" stroke-linecap="round"/>
                    <!-- headshell stub at an angle -->
                    <line x1="20" y1="56" x2="14" y2="63"
                          stroke="rgba(170,172,200,0.6)" stroke-width="2.2" stroke-linecap="round"/>
                    <!-- needle glow dot -->
                    <circle cx="13" cy="64" r="2.6"
                            fill="rgba(108,140,255,0.95)" filter="url(#armglow)"/>
                    <!-- pivot cap outer -->
                    <circle cx="60" cy="8" r="7"
                            fill="rgba(40,42,64,0.95)"
                            stroke="rgba(255,255,255,0.16)" stroke-width="1.2"/>
                    <!-- pivot cap inner highlight -->
                    <circle cx="60" cy="8" r="3"
                            fill="rgba(108,140,255,0.5)"/>
                    <circle cx="58" cy="6.5" r="1"
                            fill="rgba(255,255,255,0.4)"/>
                </svg>
            </div>`;
        }

        function updateNowPlaying(song, label = 'Last Added') {
            const panel = document.getElementById('nowPlayingPanel');
            if (!song) { panel.innerHTML = '<div class="now-playing-empty">— No track added yet —</div>'; return; }
            const songName   = song.Song || song['Track Name'] || 'Unknown';
            const artistName = song.Artist || song['Artist Name(s)'] || 'Unknown';
            const albumImage = getAlbumImage(song);
            const camelot    = song.Camelot || song['Camelot Key'] || '?';
            const bpm        = song.BPM || '?';
            const trackId    = getTrackId(song);
            const previewUrl = getPreviewUrl(song);

            panel.innerHTML = `
                ${buildTurntableArt(albumImage)}
                <div class="now-playing-info">
                    <div class="now-playing-eyebrow">${label}</div>
                    <a class="song-title-link" href="#" onclick='openSpotifyWeb(${jsString(trackId)}); return false;' title="Open in Spotify Web">
                        <div class="now-playing-title" title="${songName}">${songName}</div>
                    </a>
                    <div class="now-playing-artist">${esc(artistName)}</div>
                    <div class="now-playing-meta">
                        <span class="key-badge">${camelot}</span>
                        <span class="bpm-badge">${bpm} BPM</span>
                        ${spotifyActionHTML(trackId, true)}
                        ${sampleActionHTML(previewUrl, true)}
                    </div>
                </div>`;
        }

        function renderSetlist() {
            const tbody = document.getElementById('setlistTable');
            document.getElementById('setlistCount').textContent = `${setlist.length} tracks`;
            document.getElementById('exportBtn').disabled = setlist.length === 0;
            if (setlist.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">Your setlist is empty</div></td></tr>';
            } else {
                tbody.innerHTML = setlist.map((song, i) => {
                    const songName   = song.Song || song['Track Name'] || '';
                    const artistName = song.Artist || song['Artist Name(s)'] || '';
                    const albumImage = getAlbumImage(song);
                    const camelot    = song.Camelot || song['Camelot Key'] || '?';
                    const bpm        = song.BPM || '?';
                    const trackId    = getTrackId(song);
                    const previewUrl = getPreviewUrl(song);
                    const duration   = getSongDuration(song);
                    return `
                    <tr>
                        <td><span class="row-num">${String(i+1).padStart(2,'0')}</span></td>
                        <td class="track-action-cell">${spotifyActionHTML(trackId)}</td>
                        <td class="track-action-cell">${sampleActionHTML(previewUrl)}</td>
                        <td>
                            <div class="song-info">
                                <div class="album-art">${albumImage ? `<img src="${escAttr(albumImage)}" loading="lazy" decoding="async" alt="">` : '♪'}</div>
                                <div style="min-width:0;flex:1;">
                                    <a class="song-title-link" href="#" onclick='openSpotifyWeb(${jsString(trackId)}); return false;'>
                                        <div class="song-title" title="${escAttr(songName)}">${esc(songName)}</div>
                                    </a>
                                    <div class="song-artist" title="${escAttr(artistName)}">${esc(artistName)}</div>
                                </div>
                            </div>
                        </td>
                        <td><span class="key-badge">${esc(camelot)}</span></td>
                        <td><span class="bpm-badge">${esc(bpm)}</span></td>
                        <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${formatDuration(duration)}</td>
                        <td><button class="remove-btn" onclick="removeSong(${i})">✕</button></td>
                    </tr>`;
                }).join('');
            }
            updateSetlistStats();
        }

        function removeSong(index) {
            setlist.splice(index, 1);
            renderSetlist();
            updateNowPlaying(setlist.length > 0 ? setlist[setlist.length - 1] : null);
            updateSuggestions();
        }
        function clearSetlist() {
            if (confirm('Clear your entire setlist?')) {
                setlist = []; renderSetlist(); updateNowPlaying(null); updateSuggestions();
            }
        }
        function clearLibrary() {
            if (confirm('Delete your entire music library from browser storage?')) {
                localStorage.removeItem('djLibrary');
                allSongs = []; filteredSongs = [];
                activeKeyFilters.clear();
                keyCounts = {};
                ALL_KEYS.forEach(k => keyCounts[k] = 0);
                updateKeyButtons();
                applyFilters();
                showNotification('Library cleared', 'success');
            }
        }

        function updateSetlistStats() {
            document.getElementById('statTracks').textContent = setlist.length;
            const totalSeconds = setlist.reduce((sum, s) => sum + parseDurationToSeconds(getSongDuration(s)), 0);
            if (totalSeconds >= 3600) {
                const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = Math.floor(totalSeconds % 60);
                document.getElementById('statTime').textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
            } else {
                const m = Math.floor(totalSeconds / 60), s = Math.floor(totalSeconds % 60);
                document.getElementById('statTime').textContent = `${m}:${String(s).padStart(2,'0')}`;
            }
            const bpms = setlist.map(s => parseFloat(s.BPM || s.bpm || '')).filter(b => b > 0);
            document.getElementById('statBPM').textContent = bpms.length ? Math.round(bpms.reduce((a,b) => a+b) / bpms.length) : '—';
        }

        function getSongDuration(song) {
            return song.Duration || song['Track Duration (ms)'] || song['Duration (ms)'] || song.duration || song['Length'] || '';
        }
        function parseDurationToSeconds(val) {
            if (!val) return 0;
            const str = String(val).trim();
            if (str.includes(':')) {
                const p = str.split(':').map(Number);
                if (p.length === 2) return p[0] * 60 + p[1];
                if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
                return 0;
            }
            const n = parseFloat(str);
            return isNaN(n) ? 0 : n > 1000 ? n / 1000 : n;
        }
        function formatDuration(val) {
            const s = parseDurationToSeconds(val);
            if (s === 0) return '—';
            return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        }

        function getBpmTolerance() {
            const v = parseFloat(document.getElementById('bpmTolerance').value);
            return isNaN(v) || v < 0 ? 5 : v;
        }

        function updateSuggestions() {
            const sec = document.getElementById('suggestionsSection');
            const ctr = document.getElementById('suggestionCount');
            if (setlist.length === 0) {
                sec.innerHTML = '<div class="empty-state">Add a song to your setlist to see before/after suggestions</div>';
                if (ctr) ctr.textContent = '';
                return;
            }
            const anchorSong = buildDirection === 'before' ? setlist[0] : setlist[setlist.length - 1];
            const suggestions = getSuggestions(anchorSong);
            if (ctr) ctr.textContent = suggestions.length > 0 ? `(${suggestions.length})` : '';
            if (suggestions.length === 0) { sec.innerHTML = '<div class="empty-state">No compatible songs found</div>'; return; }
            const directionLabel = buildDirection === 'before' ? 'Suggested Previous' : 'Suggested Next';
            const visibleSuggestions = suggestions.slice(0, SUGGESTION_RENDER_LIMIT);
            const suggestionLimitNotice = suggestions.length > SUGGESTION_RENDER_LIMIT
                ? `<div class="empty-state" style="padding:8px 10px;text-align:left;border-top:1px solid rgba(255,255,255,0.05);">Showing first ${SUGGESTION_RENDER_LIMIT} suggestions. Tighten BPM tolerance or filters to narrow the list.</div>`
                : '';
            sec.innerHTML = `<div class="empty-state" style="padding:8px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.05);">${directionLabel} from anchor track</div>` + visibleSuggestions.map(s => {
                const songName   = s.Song || s['Track Name'] || '';
                const artistName = s.Artist || s['Artist Name(s)'] || '';
                const albumImage = getAlbumImage(s);
                const trackId    = getTrackId(s);
                const previewUrl = getPreviewUrl(s);
                const camelot    = s.Camelot || s['Camelot Key'] || '?';
                const bpm        = s.BPM || '?';
                return `
                <div class="suggestion-item" draggable="true" data-track-id="${trackId}">
                    ${spotifyActionHTML(trackId, true)}
                    ${sampleActionHTML(previewUrl, true)}
                    <div class="album-art" style="width:27px;height:27px;font-size:12px;">${albumImage ? `<img src="${escAttr(albumImage)}" loading="lazy" decoding="async" alt="">` : '♪'}</div>
                    <div style="flex:1;min-width:0;">
                        <a class="song-title-link" href="#" onclick='openSpotifyWeb(${jsString(trackId)}); return false;'><div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(songName)}</div></a>
                        <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${artistName}</div>
                    </div>
                    <span class="key-badge" style="font-size:10px;padding:2px 6px;">${camelot}</span>
                    <span class="bpm-badge" style="font-size:10px;padding:2px 6px;">${bpm}</span>
                    <span class="add-choice"><button class="add-mini-btn" title="Add before first track" onclick='addSongByTrackId(${jsString(trackId)}, "start")'>↑</button><button class="add-mini-btn" title="Add after last track" onclick='addSongByTrackId(${jsString(trackId)}, "end")'>↓</button></span>
                </div>`;
            }).join('') + suggestionLimitNotice;

            sec.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('dragstart', () => {
                    const t = item.dataset.trackId;
                    draggedSongData = allSongs.find(s => (s['Spotify Track Id'] || s['Spotify Track ID'] || '') === t);
                    draggedFromTable = 'library';
                    item.style.opacity = '0.4';
                });
                item.addEventListener('dragend', () => { item.style.opacity = '1'; });
            });
        }

        function getSuggestions(song) {
            const currentKey = song.Camelot || song['Camelot Key'];
            const currentBPM = parseFloat(song.BPM);
            if (!currentBPM) return [];
            const tol            = getBpmTolerance();
            const compatibleKeys = currentKey ? getCompatibleKeys(currentKey) : null;
            const trackId        = getTrackId(song);
            const setlistIds     = new Set(setlist.map(s => getTrackId(s)).filter(Boolean));

            return allSongs
                .filter(s => {
                    const sId = getTrackId(s);
                    if (sId === trackId) return false;
                    if (sId && setlistIds.has(sId)) return false;
                    const bpm = parseFloat(s.BPM);
                    if (!bpm) return false;
                    const diff = Math.min(Math.abs(bpm - currentBPM), Math.abs(bpm - currentBPM / 2), Math.abs(bpm - currentBPM * 2));
                    return diff <= tol;
                })
                .map(s => {
                    const bpm  = parseFloat(s.BPM);
                    const sKey = s.Camelot || s['Camelot Key'];
                    const diff = Math.min(Math.abs(bpm - currentBPM), Math.abs(bpm - currentBPM / 2), Math.abs(bpm - currentBPM * 2));
                    const bpmScore = tol > 0 ? (1 - diff / tol) * 100 : 100;
                    let keyBonus = 0;
                    if (compatibleKeys) {
                        if (sKey === currentKey) keyBonus = 50;
                        else if (compatibleKeys.includes(sKey)) keyBonus = 30;
                    }
                    return { song: s, score: bpmScore + keyBonus };
                })
                .sort((a, b) => b.score - a.score)
                .map(c => c.song);
        }

        function getCompatibleKeys(key) {
            const wheel = {
                '1A':['1A','12A','2A','1B'],'2A':['2A','1A','3A','2B'],'3A':['3A','2A','4A','3B'],
                '4A':['4A','3A','5A','4B'],'5A':['5A','4A','6A','5B'],'6A':['6A','5A','7A','6B'],
                '7A':['7A','6A','8A','7B'],'8A':['8A','7A','9A','8B'],'9A':['9A','8A','10A','9B'],
                '10A':['10A','9A','11A','10B'],'11A':['11A','10A','12A','11B'],'12A':['12A','11A','1A','12B'],
                '1B':['1B','12B','2B','1A'],'2B':['2B','1B','3B','2A'],'3B':['3B','2B','4B','3A'],
                '4B':['4B','3B','5B','4A'],'5B':['5B','4B','6B','5A'],'6B':['6B','5B','7B','6A'],
                '7B':['7B','6B','8B','7A'],'8B':['8B','7B','9B','8A'],'9B':['9B','8B','10B','9A'],
                '10B':['10B','9B','11B','10A'],'11B':['11B','10B','12B','11A'],'12B':['12B','11B','1B','12A']
            };
            return wheel[key] || [];
        }

        function exportSetlist() {
            if (setlist.length === 0) return;
            const headers = Object.keys(setlist[0]);
            const csv = [headers.join('\t'), ...setlist.map(s => headers.map(h => s[h]).join('\t'))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `setlist-${Date.now()}.csv`; a.click();
            URL.revokeObjectURL(url);
            showNotification('Setlist exported', 'success');
        }

        const sortState = {};
        function sortLibrary(column) {
            sortState[column] = sortState[column] === 'asc' ? 'desc' : 'asc';
            const dir = sortState[column] === 'asc' ? 1 : -1;
            const numericCols = new Set(['BPM', 'bpm', 'Duration', 'duration', 'Track Duration (ms)', 'Duration (ms)', 'Length']);
            filteredSongs.sort((a, b) => {
                let aVal = a[column] || '', bVal = b[column] || '';
                if (numericCols.has(column)) {
                    const aNum = column.toLowerCase().includes('duration') || column === 'Length' ? parseDurationToSeconds(aVal) : parseFloat(aVal) || 0;
                    const bNum = column.toLowerCase().includes('duration') || column === 'Length' ? parseDurationToSeconds(bVal) : parseFloat(bVal) || 0;
                    return (aNum - bNum) * dir;
                }
                return aVal.localeCompare(bVal) * dir;
            });
            renderLibrary();
        }

        function showNotification(msg, type = 'info') {
            const n = document.createElement('div');
            n.className = `notification ${type}`;
            n.textContent = msg;
            document.body.appendChild(n);
            setTimeout(() => n.remove(), 3000);
        }
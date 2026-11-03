const API_URL = "https://tgbot-ljmn.onrender.com"; 

let globalData = null;
let currentLessonId = null;
let currentBookIndex = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`${API_URL}/api/lessons.json`, { method: 'GET', mode: 'cors' });
        if (!response.ok) throw new Error(`Ошибка сервера: ${response.status}`);
        
        globalData = await response.json();
        
        // Привязка базовых кнопок
        document.getElementById('btn-save-note').onclick = saveNote;
        document.getElementById('btn-export-note').onclick = downloadNote;
        document.getElementById('btn-clear-note').onclick = clearNote;
        document.getElementById('btn-insert-time').onclick = insertTimecode;
        // Кнопки форматирования
        document.getElementById('btn-fullscreen-note').onclick = toggleFullscreen;
        document.getElementById('font-selector').onchange = (e) => {
            const font = e.target.value;
            document.getElementById('notebook-paper').style.fontFamily = font;
            document.getElementById('note-text').style.fontFamily = font;
        };

        // Инициализация кастомного аудиоплеера
        initAudioPlayer();

        // Запуск роутера
        window.addEventListener('hashchange', router);
        router(); 

    } catch (error) {
        document.getElementById('books-container').innerHTML = `<p style="color:red">Ошибка загрузки: ${error.message}. Попробуйте использовать VPN.</p>`;
    }
});

// ==========================================
// РОУТЕР И УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ
// ==========================================
function navigate(hash) {
    window.location.hash = hash;
}

function router() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/').filter(p => p);

    const header = document.getElementById('main-header');
    const footer = document.getElementById('main-footer');
    const backContainer = document.getElementById('nav-back-container');
    const backBtn = document.getElementById('nav-back-btn');

    document.getElementById('page-home').style.display = 'none';
    document.getElementById('page-book').style.display = 'none';
    document.getElementById('page-lesson').style.display = 'none';

    // НЕ очищаем src — просто ставим на паузу (иначе AbortError)
    const player = document.getElementById('audio-player');
    if (player && !player.paused) player.pause();

    if (parts.length === 0) {
        header.style.display = 'flex';
        footer.style.display = 'block';
        backContainer.style.display = 'none';
        document.getElementById('page-home').style.display = 'block';
        renderBooksList();
    } 
    else if (parts[0] === 'book' && parts.length === 2) {
        header.style.display = 'none';
        footer.style.display = 'none';
        backContainer.style.display = 'block';
        
        backBtn.onclick = (e) => { e.preventDefault(); navigate(''); };
        backBtn.innerText = "← Назад ко всем книгам";

        document.getElementById('page-book').style.display = 'block';
        currentBookIndex = parts[1];
        renderBookDetails(parts[1]); 
    }
    else if (parts[0] === 'book' && parts.length === 4 && parts[2] === 'lesson') {
        header.style.display = 'none';
        footer.style.display = 'none';
        backContainer.style.display = 'block';
        
        backBtn.onclick = (e) => { e.preventDefault(); navigate(`book/${parts[1]}`); };
        backBtn.innerText = "← Назад к частям";

        document.getElementById('page-lesson').style.display = 'block';
        currentBookIndex = parts[1];
        renderLessonPage(parts[1], parts[3]); 
    }
}

// ==========================================
// ОТРИСОВКА КОНТЕНТА
// ==========================================
function renderBooksList() {
    const container = document.getElementById('books-container');
    let html = '';
    
    Object.entries(globalData.books).forEach(([title, data], index) => {
        html += `
        <a href="#book/${index}">
            <div class="book">
                    <img src="images/over_ear_headphones_falt_style.svg" alt="">
                    <h3>${title}</h3>
                    <p>${data.author}</p>
                    <p>Частей: ${data.lessons.length}</p>
            </div>
        </a>
        `;
    });
    container.innerHTML = html || '<p>Пока нет книг.</p>';
}

function renderBookDetails(bookIndex) {
    const bookEntry = Object.entries(globalData.books)[bookIndex];
    if (!bookEntry) return navigate('');
    const [title, data] = bookEntry;
    
    document.getElementById('book-title-display').innerText = title;
    document.getElementById('book-author-display').innerText = data.author;
    
    const container = document.getElementById('lessons-container');
    let html = '';

    data.lessons.sort((a, b) => a.part - b.part);

    data.lessons.forEach((lesson) => {
        const realIndex = data.lessons.findIndex(l => l.id === lesson.id);
        html += `
            <div class="book">
                <a href="#book/${bookIndex}/lesson/${realIndex}">
                    <h3 style="border-bottom:none; text-aligin:center;">Урок ${lesson.part}: ${lesson.title}</h3>
                </a>
            </div>
        `;
    });
    container.innerHTML = html || '<p>В этой книге пока нет уроков.</p>';
}

function renderLessonPage(bookIndex, lessonIndex) {
    const bookEntry = Object.entries(globalData.books)[bookIndex];
    if (!bookEntry) return navigate('');
    const [bookTitle, bookData] = bookEntry;

    const lesson = bookData.lessons[lessonIndex];
    if (!lesson) return navigate('');

    currentLessonId = lesson.id;

    document.getElementById('lesson-book-title').innerText = bookTitle;
    document.getElementById('lesson-title-display').innerText = `Урок ${lesson.part}: ${lesson.title}`;

    const player = document.getElementById('audio-player');

    // Нормализуем URL аудио
    let audioUrl = lesson.audio_url || lesson.audioUrl || lesson.url || lesson.audio || '';
    if (audioUrl && !/^https?:\/\//i.test(audioUrl)) {
        audioUrl = `${API_URL}/${audioUrl.replace(/^\//, '')}`;
    }

    if (audioUrl) {
        player.src = audioUrl;
        player.load();
    } else {
        player.removeAttribute('src');
        player.load();
        console.warn('Нет audio_url у урока:', lesson);
        alert("Аудио для этого урока еще не загружено!");
    }

    loadNote();
}

// ==========================================
// ЛОГИКА ЗАМЕТОК
// ==========================================
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function insertTimecode() {
    const player = document.getElementById('audio-player');
    const textarea = document.getElementById('note-text');
    if (!player.src) return alert("Сначала включите аудио!");

    const timeStr = formatTime(player.currentTime);
    const insertStr = `[${timeStr}] `;

    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    
    textarea.value = textarea.value.substring(0, startPos) + insertStr + textarea.value.substring(endPos, textarea.value.length);
    textarea.selectionStart = textarea.selectionEnd = startPos + insertStr.length;
    textarea.focus();
}

function wrapText(openTag, closeTag) {
    const textarea = document.getElementById('note-text');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    const selected = text.substring(start, end);
    const newText = text.substring(0, start) + openTag + selected + closeTag + text.substring(end);
    
    textarea.value = newText;
    textarea.focus();
    textarea.setSelectionRange(start + openTag.length, end + openTag.length);
}

function toggleFullscreen() {
    const wrapper = document.getElementById('notes-wrapper');
    wrapper.classList.toggle('fullscreen');
    
    const btn = document.getElementById('btn-fullscreen-note');
    if (wrapper.classList.contains('fullscreen')) {
        btn.innerText = "Выйти из полноэкранного";
    } else {
        btn.innerText = "⛶ На весь экран";
    }
}

function loadNote() {
    const textarea = document.getElementById('note-text');
    const displayContainer = document.getElementById('saved-notes-container');
    const display = document.getElementById('saved-note-display');
    const savedText = localStorage.getItem(`note_${currentLessonId}`) || '';
    
    textarea.value = savedText;
    
    if (savedText) {
        displayContainer.style.display = 'block';
        display.innerHTML = formatNoteForDisplay(savedText);
    } else {
        displayContainer.style.display = 'none';
        display.innerHTML = '';
    }

    document.getElementById('notebook-details').removeAttribute('open');
}

function saveNote() {
    const textarea = document.getElementById('note-text');
    const displayContainer = document.getElementById('saved-notes-container');
    const display = document.getElementById('saved-note-display');
    
    if (!textarea.value.trim()) {
        localStorage.removeItem(`note_${currentLessonId}`);
        displayContainer.style.display = 'none';
        display.innerHTML = '';
        alert("Заметка пуста и удалена.");
        return;
    }
    
    localStorage.setItem(`note_${currentLessonId}`, textarea.value);
    displayContainer.style.display = 'block';
    display.innerHTML = formatNoteForDisplay(textarea.value);
    
    document.getElementById('notebook-details').removeAttribute('open');
    
    alert("Заметка сохранена!");
}

function clearNote() {
    if(confirm("Удалить заметку?")) {
        const textarea = document.getElementById('note-text');
        const display = document.getElementById('saved-note-display');
        textarea.value = '';
        display.innerHTML = '';
        display.style.display = 'none';
        localStorage.removeItem(`note_${currentLessonId}`);
    }
}

function formatNoteForDisplay(text) {
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    const timeRegex = /\[(\d+:\d+)\]/g;
    html = html.replace(timeRegex, (match, time) => {
        return `<span class="time-link" onclick="jumpToTime('${time}')">${match}</span>`;
    });
    
    return html;
}

function jumpToTime(timeStr) {
    const player = document.getElementById('audio-player');
    if (!player) return;

    const parts = timeStr.split(':');
    const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    
    player.currentTime = seconds;
    
    // Безопасный запуск воспроизведения
    const p = player.play();
    if (p && typeof p.catch === 'function') {
        p.catch(err => {
            if (err.name !== 'AbortError') console.warn('Ошибка воспроизведения:', err);
        });
    }
}

function downloadNote() {
    const text = document.getElementById('note-text').value;
    if (!text) return alert("Нет текста для экспорта!");
    
    const bookTitle = document.getElementById('lesson-book-title').innerText;
    const lessonTitle = document.getElementById('lesson-title-display').innerText;

    const fileContent = `Книга: ${bookTitle}\nУрок: ${lessonTitle}\n\n${text}`;
    
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Заметка_${lessonTitle.replace(/[^a-zа-я0-9]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// ЛОГИКА КАСТОМНОГО АУДИОПЛЕЕРА
// ==========================================
function initAudioPlayer() {
    const audio = document.getElementById('audio-player');
    const playBtn = document.getElementById('btn-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const thumb = document.getElementById('player-thumb');
    const timeCurrent = document.getElementById('time-current');
    const timeTotal = document.getElementById('time-total');
    const btnRewind = document.getElementById('btn-rewind');
    const btnForward = document.getElementById('btn-forward');
    const speedSelect = document.getElementById('speed-select');
    const playerWrapper = document.getElementById('custom-player');

    if (!audio || !playBtn) return;

    const formatAudioTime = (seconds) => {
        if (isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const safePlay = () => {
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
            p.catch(err => { if (err.name !== 'AbortError') console.warn(err); });
        }
    };

    // Play / Pause
    playBtn.addEventListener('click', () => {
        if (audio.paused) safePlay(); else audio.pause();
    });

    audio.addEventListener('play', () => {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    });
    audio.addEventListener('pause', () => {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    });

    // Обновление прогресса
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const percent = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${percent}%`;
        timeCurrent.innerText = formatAudioTime(audio.currentTime);
    });

    audio.addEventListener('loadedmetadata', () => {
        timeTotal.innerText = formatAudioTime(audio.duration);
    });

    // --- ЛОГИКА ПЕРЕТАСКИВАНИЯ ПОЛЗУНКА (DRAG) ---
    let isDragging = false;

    const updateProgress = (clientX) => {
        const rect = progressContainer.getBoundingClientRect();
        let pos = (clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); // Ограничиваем от 0 до 1
        
        if (audio.duration) {
            audio.currentTime = pos * audio.duration;
            progressBar.style.width = `${pos * 100}%`;
            timeCurrent.innerText = formatAudioTime(audio.currentTime);
        }
    };

    progressContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        playerWrapper.classList.add('dragging');
        updateProgress(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) updateProgress(e.clientX);
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            playerWrapper.classList.remove('dragging');
        }
    });

    // Поддержка тач-экранов (мобилки)
    progressContainer.addEventListener('touchstart', (e) => {
        isDragging = true;
        playerWrapper.classList.add('dragging');
        updateProgress(e.touches[0].clientX);
    });

    document.addEventListener('touchmove', (e) => {
        if (isDragging) {
            updateProgress(e.touches[0].clientX);
            e.preventDefault(); // Запрещаем скролл страницы при перемотке
        }
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (isDragging) {
            isDragging = false;
            playerWrapper.classList.remove('dragging');
        }
    });

    // Кнопки +-15 сек
    btnRewind.addEventListener('click', () => {
        audio.currentTime = Math.max(0, audio.currentTime - 15);
    });
    btnForward.addEventListener('click', () => {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15);
    });

    // Скорость
    speedSelect.addEventListener('change', () => {
        audio.playbackRate = parseFloat(speedSelect.value);
    });

    // Горячие клавиши (пробел, стрелки)
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (audio.paused) safePlay(); else audio.pause();
        } else if (e.code === 'ArrowLeft') {
            audio.currentTime = Math.max(0, audio.currentTime - 15);
        } else if (e.code === 'ArrowRight') {
            audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15);
        }
    });
}
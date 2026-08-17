(function (global) {
    let activeRequest = null;
    const queue = [];

    function elements() {
        return {
            overlay: document.getElementById('appDialog'),
            dialog: document.querySelector('#appDialog .app-dialog'),
            title: document.getElementById('appDialogTitle'),
            message: document.getElementById('appDialogMessage'),
            icon: document.getElementById('appDialogIcon'),
            field: document.getElementById('appDialogField'),
            label: document.getElementById('appDialogInputLabel'),
            input: document.getElementById('appDialogInput'),
            cancel: document.getElementById('appDialogCancel'),
            confirm: document.getElementById('appDialogConfirm')
        };
    }

    function renderNext() {
        if (activeRequest || !queue.length) return;
        const parts = elements();
        activeRequest = queue.shift();
        const options = activeRequest.options;
        parts.title.textContent = options.title;
        parts.message.textContent = options.message;
        parts.dialog.classList.toggle('compact', Boolean(options.compact));
        parts.icon.textContent = options.icon;
        parts.icon.className = `app-dialog-icon ${options.tone}`;
        parts.field.style.display = activeRequest.type === 'prompt' ? 'block' : 'none';
        parts.label.textContent = options.inputLabel;
        parts.input.value = options.defaultValue;
        parts.input.placeholder = options.placeholder;
        parts.cancel.style.display = activeRequest.type === 'notice' ? 'none' : '';
        parts.cancel.textContent = options.cancelText;
        parts.confirm.textContent = options.confirmText;
        parts.confirm.classList.toggle('app-dialog-danger', options.tone === 'danger');
        parts.overlay.style.display = 'flex';
        requestAnimationFrame(() => {
            if (activeRequest.type === 'prompt') {
                parts.input.focus();
                parts.input.select();
            } else {
                parts.confirm.focus();
            }
        });
    }

    function finish(confirmed) {
        if (!activeRequest) return;
        const parts = elements();
        const request = activeRequest;
        activeRequest = null;
        parts.overlay.style.display = 'none';
        const value = request.type === 'prompt'
            ? (confirmed ? parts.input.value.trim() : null)
            : Boolean(confirmed);
        request.resolve(value);
        request.previousFocus?.focus?.();
        renderNext();
    }

    function request(type, message, options = {}) {
        const defaults = {
            title: type === 'notice' ? 'Alô Cozinha' : (type === 'prompt' ? 'Novo item' : 'Confirmar ação'),
            message: String(message || ''),
            icon: type === 'notice' ? 'i' : (type === 'prompt' ? '+' : '!'),
            tone: 'default',
            confirmText: type === 'notice' ? 'Entendi' : (type === 'prompt' ? 'Adicionar' : 'Confirmar'),
            cancelText: 'Cancelar',
            inputLabel: 'Digite abaixo',
            defaultValue: '',
            placeholder: '',
            compact: false
        };
        return new Promise(resolve => {
            queue.push({
                type,
                options: { ...defaults, ...options, message: String(message || options.message || '') },
                previousFocus: document.activeElement,
                resolve
            });
            renderNext();
        });
    }

    function confirm(message, options) { return request('confirm', message, options); }
    function prompt(message, options) { return request('prompt', message, options); }
    function notice(message, options) { return request('notice', message, options); }

    document.addEventListener('DOMContentLoaded', () => {
        const parts = elements();
        parts.cancel.addEventListener('click', () => finish(false));
        parts.confirm.addEventListener('click', () => finish(true));
        parts.overlay.addEventListener('click', event => {
            if (event.target === parts.overlay && activeRequest?.type !== 'notice') finish(false);
        });
        parts.input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
            }
        });
        document.addEventListener('keydown', event => {
            if (!activeRequest) return;
            if (event.key === 'Escape' && activeRequest.type !== 'notice') {
                event.preventDefault();
                finish(false);
            }
        });
    });

    global.AloUiDialog = Object.freeze({ confirm, prompt, notice });
    global.alert = message => { notice(message); };
})(window);

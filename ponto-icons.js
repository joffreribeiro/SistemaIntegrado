// icons.js - centraliza pequenos SVGs e helpers de badges
(function(global){
    // improved icons map: consistent viewBox and using currentColor for easy theming
    // svgIcon(name, opts?) where opts can be:
    // - a string -> treated as title
    // - an object -> { title?: string, color?: '#rrggbb' }
    // If no color is provided, use a sensible default per-icon to obtain colorful icons.
    function svgIcon(name, opts) {
        const icons = {
            chart: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M3 3h2v18H3zM8 10h2v11H8zM13 5h2v16h-2zM18 13h2v8h-2z"/></svg>`,
            edit: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
            timer: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 8v5l3 2"/><path fill="currentColor" d="M12 1a11 11 0 1 0 11 11A11 11 0 0 0 12 1z"/></svg>`,
            check: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`,
            trash: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/></svg>`,
            clipboard: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M16 4h-1.5l-.71-.71A1 1 0 0 0 12.9 3h-1.8a1 1 0 0 0-.89.29L9.5 4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM12 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>`,
            calendar: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7 10h5v5H7zM19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM5 20V9h14l.002 11z"/></svg>`,
            refresh: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-5 5 5 5 0 0 1-4.9-4H5a8 8 0 0 0 12.65-7.65z"/></svg>`,
            plus: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"/></svg>`,
            shuffle: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10 4H8l4 6-4 6h2l4-6zM20 7v4h-2V9.41l-3.29 3.3-1.42-1.42L16.59 8H14V6h6z"/></svg>`,
            close: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M18.3 5.71L12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7 2.87 18.29 9.17 12 2.87 5.71 4.29 4.29 10.59 10.6 16.88 4.29z"/></svg>`,
            export: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-18L5.33 9h3.84v6h4.66V9h3.84L12 2z"/></svg>`,
            gear: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19.14 12.94a7.14 7.14 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.65l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.6 2h-3.2a.5.5 0 0 0-.49.42l-.36 2.54a7.1 7.1 0 0 0-1.62.94L4.02 5.86a.5.5 0 0 0-.6.22L1.5 9.4a.5.5 0 0 0 .12.65L3.65 11.6a7.14 7.14 0 0 0 0 1.88L1.62 15.06a.5.5 0 0 0-.12.65l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54a.5.5 0 0 0 .49.42h3.2a.5.5 0 0 0 .49-.42l.36-2.54c.57-.24 1.12-.56 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.65l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>`,
            help: `<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm1.07-7.75c-.9.92-1.07 1.25-1.07 2.25h-2v-.5c0-1.1.45-1.99 1.17-2.71.74-.74 1.58-1.29 1.58-2.54 0-1.3-1.02-2.25-2.5-2.25s-2.5.95-2.5 2.25H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.45-.66 2.15-1.93 3.25z"/></svg>`
        };

        // normalize opts
        let title;
        let color;
        if (typeof opts === 'string') {
            title = opts;
        } else if (opts && typeof opts === 'object') {
            title = opts.title;
            color = opts.color;
        }

        // default per-icon colors (can be overridden by opts.color)
        const defaultColors = {
            edit: '#2563eb', // blue
            trash: '#dc2626', // red
            close: '#475569', // slate
            check: '#16a34a', // green
            plus: '#06b6d4', // cyan
            export: '#8b5cf6', // purple
            calendar: '#f97316', // orange
            timer: '#f43f5e', // pinkish
            gear: '#64748b', // gray
            chart: '#0ea5a4', // teal
            refresh: '#10b981', // emerald
            help: '#f59e0b' // amber
        };

        let svg = icons[name] || '';
        if (!svg) return '';

        const useColor = color || defaultColors[name] || null;
        if (useColor) {
            // replace occurrences of currentColor with explicit color
            // safe basic replace — icons use 'currentColor' in paths
            svg = svg.replace(/currentColor/g, useColor);
        }

        // If a title is provided, inject a <title> and set role="img".
        if (title) {
            svg = svg.replace('<svg ', '<svg role="img" ');
            // inject title after opening tag
            svg = svg.replace('>', `><title>${Utils.escapeHtml(title)}</title>`);
            return svg;
        }

        // Otherwise mark decorative icons as hidden from assistive tech
        svg = svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
        return svg;
    }

    function getPriorityBadge(priority) {
        if (!priority) return '';
        const p = String(priority).toLowerCase();
        const map = {
            'critica': 'badge badge--overdue',
            'alta': 'badge badge--due',
            'media': 'badge badge--ok',
            'baixa': 'badge badge--ok'
        };
        const cls = map[p] || 'badge badge--order';
        return `<span class="${cls}">${Utils.escapeHtml(priority)}</span>`;
    }

    const exports = { svgIcon, getPriorityBadge };
    global.Icons = exports;
    // backward-compat: expose short names
    global.svgIcon = svgIcon;
    global.getPriorityBadge = getPriorityBadge;
})(window);

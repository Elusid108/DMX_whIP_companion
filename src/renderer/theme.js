// Canvas access to the CSS colour tokens in input.css (--c-<name>), so
// canvases follow the theme instead of hard-coding hex. Values are cached per
// theme class; a theme switch re-reads them on the next call.
let cacheKey = null;
let cache = {};

const tokenRgb = (name) => {
    const root = document.documentElement;
    if (root.className !== cacheKey) {
        cacheKey = root.className;
        cache = {};
    }
    let rgb = cache[name];
    if (!rgb) {
        const raw = getComputedStyle(root).getPropertyValue(`--c-${name}`).trim();
        rgb = raw.split(/\s+/).map(Number);
        if (rgb.length !== 3 || rgb.some((value) => !Number.isFinite(value))) {
            rgb = [128, 128, 128];
        }
        cache[name] = rgb;
    }
    return rgb;
};

const tokenColor = (name, alpha = 1) => {
    const [r, g, b] = tokenRgb(name);
    return `rgba(${r},${g},${b},${alpha})`;
};

const applyTheme = (theme) => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme === 'light' ? 'light' : 'dark');
};

module.exports = { tokenRgb, tokenColor, applyTheme };

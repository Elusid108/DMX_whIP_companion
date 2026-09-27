const { useEffect, useState } = require('react');

// Tailwind breakpoints (tailwind.config.js defaults).
const BREAKPOINTS = {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
    coarse: '(pointer: coarse)'
};

// True while the media query matches; follows window resizes.
const useMediaQuery = (query) => {
    const media = BREAKPOINTS[query] || query;
    const [matches, setMatches] = useState(() => window.matchMedia(media).matches);
    useEffect(() => {
        const list = window.matchMedia(media);
        const update = () => setMatches(list.matches);
        update();
        list.addEventListener('change', update);
        return () => list.removeEventListener('change', update);
    }, [media]);
    return matches;
};

module.exports = useMediaQuery;

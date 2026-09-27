const React = require('react');

// One copy of every UI icon. Stroke icons sit on a 24 px grid and inherit
// currentColor; pass className to size or colour them (default 14 px).
const h = React.createElement;
const path = (d) => h('path', { d });

const strokeIcon = (...parts) => {
    const Icon = ({ className = 'w-3.5 h-3.5', ...rest }) => h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className,
        'aria-hidden': true,
        ...rest
    }, ...parts);
    return Icon;
};

const fillIcon = (...parts) => {
    const Icon = ({ className = 'w-3.5 h-3.5', ...rest }) => h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'currentColor',
        className,
        'aria-hidden': true,
        ...rest
    }, ...parts);
    return Icon;
};

const FOLDER = ['M3 7h6l2 2h10v10H3z', 'M3 7V5h6l2 2'];

const Chevron = strokeIcon(path('M9 6l6 6-6 6'));
const ChevronDown = strokeIcon(path('M6 9l6 6 6-6'));
const Close = strokeIcon(path('M6 6l12 12'), path('M18 6L6 18'));
const Plus = strokeIcon(path('M12 5v14'), path('M5 12h14'));
const Check = strokeIcon(path('M5 12.5l4.5 4.5L19 7.5'));
const ArrowUp = strokeIcon(path('M12 19V5'), path('M6 11l6-6 6 6'));
const ArrowDown = strokeIcon(path('M12 5v14'), path('M6 13l6 6 6-6'));
const Trash = strokeIcon(path('M4 7h16'), path('M10 11v6M14 11v6'), path('M6 7l1 13h10l1-13'), path('M9 7V4h6v3'));
const Menu = strokeIcon(path('M4 6h16'), path('M4 12h16'), path('M4 18h16'));
const More = fillIcon(h('circle', { cx: 12, cy: 5, r: 1.8 }), h('circle', { cx: 12, cy: 12, r: 1.8 }), h('circle', { cx: 12, cy: 19, r: 1.8 }));
const Repeat = strokeIcon(
    path('M17 2l4 4-4 4'),
    path('M3 11V9a4 4 0 0 1 4-4h14'),
    path('M7 22l-4-4 4-4'),
    path('M21 13v2a4 4 0 0 1-4 4H3')
);
const Cog = strokeIcon(
    h('circle', { cx: 12, cy: 12, r: 3 }),
    path('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z')
);
const Popout = strokeIcon(
    path('M15 3h6v6'),
    path('M10 14L21 3'),
    path('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')
);
const Eye = strokeIcon(path('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'), h('circle', { cx: 12, cy: 12, r: 3 }));
const EyeOff = strokeIcon(
    path('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'),
    h('circle', { cx: 12, cy: 12, r: 3 }),
    path('M3 3l18 18')
);
const Folder = strokeIcon(...FOLDER.map(path));
const FolderPlus = strokeIcon(...FOLDER.map(path), path('M12 12v6M9 15h6'));
const PushSd = strokeIcon(
    path('M3 12h8'),
    path('M8 8l4 4-4 4'),
    path('M13 6.5h3.2L20 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-5.5A1.5 1.5 0 0 1 11.5 17V8A1.5 1.5 0 0 1 13 6.5z'),
    path('M15 9.5v3M17.2 9.5v3')
);
const Play = fillIcon(path('M8 5.2v13.6L19.4 12z'));

module.exports = {
    ArrowDown,
    ArrowUp,
    Check,
    Chevron,
    ChevronDown,
    Close,
    Cog,
    Eye,
    EyeOff,
    Folder,
    FolderPlus,
    Menu,
    More,
    Play,
    Plus,
    Popout,
    PushSd,
    Repeat,
    Trash
};

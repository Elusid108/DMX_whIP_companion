// One source for timeline row heights: the drag / hit-test maths use these
// numbers and the CSS reads them as --tl-* variables (input.css).
const TIMELINE = {
    rulerH: 32,
    laneH: 56,
    rowH: 28,
    audioRowH: 40
};

const applyTimelineMetrics = () => {
    const style = document.documentElement.style;
    style.setProperty('--tl-ruler', `${TIMELINE.rulerH}px`);
    style.setProperty('--tl-lane', `${TIMELINE.laneH}px`);
    style.setProperty('--tl-row', `${TIMELINE.rowH}px`);
    style.setProperty('--tl-audio-row', `${TIMELINE.audioRowH}px`);
};

module.exports = { TIMELINE, applyTimelineMetrics };

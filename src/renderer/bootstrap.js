const React = require('react');
const { createRoot } = require('react-dom/client');
const App = require('./App');
const { applyTimelineMetrics } = require('./components/studio/timelineMetrics');

applyTimelineMetrics();

const container = document.getElementById('root');
const root = createRoot(container);
root.render(React.createElement(App));

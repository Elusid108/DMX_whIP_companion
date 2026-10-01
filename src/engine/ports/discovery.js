/**
 * Discovery strategy interface (docs/engine/API.md §10). Strategies are core
 * code over the udp port, so there is no adapter; this file fixes the shape
 * every strategy has and the node record they produce.
 *
 * @typedef {Object} DiscoveryNode
 * @property {string} id MAC when known, else IP.
 * @property {string} mac
 * @property {string} ip
 * @property {string} name Short name.
 * @property {string} longName
 * @property {number[]} universes
 * @property {number} bindIndex
 * @property {number} oem
 * @property {string} nodeReport
 * @property {boolean} paired Passed the whIP pairing rule.
 * @property {boolean} stale
 * @property {number} lastSeen Clock ms.
 * @property {string[]} sources Strategy kinds that reported it.
 *
 * @typedef {Object} DiscoveryStrategy
 * @property {'artpollBroadcast' | 'unicastPoll' | 'manual' | 'knownNodes'} kind
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => Object} describe The strategy's config, for discovery.state.
 */
const KINDS = ['artpollBroadcast', 'unicastPoll', 'manual', 'knownNodes'];

const assertStrategy = (strategy) => {
    if (!strategy || !KINDS.includes(strategy.kind) || typeof strategy.start !== 'function' || typeof strategy.stop !== 'function') {
        throw new Error('a discovery strategy needs kind, start() and stop()');
    }
    return strategy;
};

module.exports = { KINDS, assertStrategy };

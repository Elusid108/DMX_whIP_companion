const { useState, useEffect, useRef } = require('react');
const ipcRenderer = require('../ipc');

const emptyGrid = () => new Array(512).fill(null);

const useDmxMonitor = (selectedUniverse, selectedProtocol, { monitorVisible } = {}) => {
    const [dmxData, setDmxData] = useState(emptyGrid());
    const [networkInterfaces, setNetworkInterfaces] = useState([]);
    const [selectedNic, setSelectedNic] = useState('0.0.0.0');
    const [displayFormat, setDisplayFormat] = useState('decimal');
    const [gridDimensions, setGridDimensions] = useState('32x16');
    const [showAnimations, setShowAnimations] = useState(true);
    const visibleRef = useRef(true);
    visibleRef.current = monitorVisible !== false;

    useEffect(() => {
        const loadNetworkInterfaces = async () => {
            const interfaces = await ipcRenderer.invoke('get-network-interfaces');
            setNetworkInterfaces(interfaces || []);
        };

        loadNetworkInterfaces();
    }, []);

    useEffect(() => {
        setDmxData(emptyGrid());
    }, [selectedUniverse, selectedProtocol]);

    useEffect(() => {
        const handleDmxUpdate = (event, data) => {
            if (!visibleRef.current) {
                return;
            }
            if (data.protocol !== selectedProtocol || data.universe !== selectedUniverse) {
                return;
            }
            setDmxData(Array.isArray(data.data) ? data.data : emptyGrid());
        };

        const handleClearUniverses = () => {
            setDmxData(emptyGrid());
        };

        ipcRenderer.on('dmx-data-update', handleDmxUpdate);
        ipcRenderer.on('clear-universes', handleClearUniverses);

        return () => {
            ipcRenderer.removeListener('dmx-data-update', handleDmxUpdate);
            ipcRenderer.removeListener('clear-universes', handleClearUniverses);
        };
    }, [selectedUniverse, selectedProtocol]);

    useEffect(() => {
        setDmxData(emptyGrid());
        ipcRenderer.send('set-protocol', { interfaceIp: selectedNic });
    }, [selectedNic]);

    const handleNetworkChange = (nicIp) => {
        setSelectedNic(nicIp);
    };

    const handleDisplayFormatChange = (format) => {
        setDisplayFormat(format);
    };

    const handleGridDimensionsChange = (dimensions) => {
        setGridDimensions(dimensions);
    };

    const toggleAnimations = () => {
        setShowAnimations(prev => !prev);
    };

    return {
        dmxData,
        networkInterfaces,
        selectedNic,
        displayFormat,
        gridDimensions,
        showAnimations,
        handleNetworkChange,
        handleDisplayFormatChange,
        handleGridDimensionsChange,
        toggleAnimations
    };
};

module.exports = useDmxMonitor;

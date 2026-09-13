const { useState, useEffect } = require('react');
const { ipcRenderer } = require('electron');

const useDmxMonitor = (selectedUniverse, selectedProtocol) => {
    const [dmxData, setDmxData] = useState(new Array(512).fill(null));
    const [networkInterfaces, setNetworkInterfaces] = useState([]);
    const [selectedNic, setSelectedNic] = useState('0.0.0.0');
    const [displayFormat, setDisplayFormat] = useState('decimal');
    const [gridDimensions, setGridDimensions] = useState('16x32');
    const [showAnimations, setShowAnimations] = useState(true);

    useEffect(() => {
        const loadNetworkInterfaces = async () => {
            const interfaces = await ipcRenderer.invoke('get-network-interfaces');
            setNetworkInterfaces(interfaces || []);
        };

        loadNetworkInterfaces();
    }, []);

    useEffect(() => {
        const handleDmxUpdate = (event, data) => {
            if (data.protocol === selectedProtocol && 
                data.universe === selectedUniverse && 
                (selectedNic === '0.0.0.0' || data.sourceIp === selectedNic || data.sourceIp === '127.0.0.1')) {
                
                setDmxData(prevData => {
                    const newData = new Array(512).fill(null);
                    data.data.forEach((value, index) => {
                        if (value > 0 || prevData[index] !== null) {
                            newData[index] = value;
                        }
                    });
                    return newData;
                });
            }
        };

        ipcRenderer.on('dmx-data-update', handleDmxUpdate);
        
        return () => {
            ipcRenderer.removeListener('dmx-data-update', handleDmxUpdate);
        };
    }, [selectedUniverse, selectedProtocol, selectedNic]);

    useEffect(() => {
        // When network interface changes, clear DMX data and notify main process
        setDmxData(new Array(512).fill(null));
        ipcRenderer.send('set-protocol', { interfaceIp: selectedNic });
        // Also trigger a universe clear to remove stale data
        ipcRenderer.send('clear-universes');
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
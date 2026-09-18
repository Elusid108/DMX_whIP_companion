const MIN_FIRMWARE_API = 1;

const statusApi = (status) => {
    if (!status || status.api == null || status.api === '') {
        return 0;
    }
    const n = Number(status.api);
    return Number.isFinite(n) ? n : 0;
};

const apiTooOld = (status) => statusApi(status) < MIN_FIRMWARE_API;

module.exports = {
    MIN_FIRMWARE_API,
    statusApi,
    apiTooOld
};

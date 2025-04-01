// New file: remoteApiService.js
const axios = require('axios');

const ORDPI_API_BASE = 'http://192.168.178.54:8080/api';

const remoteApiService = {
  async mintRune(amount, signatures) {
    return axios.post(`${ORDPI_API_BASE}/runes/mint`, {
      amount,
      signatures
    });
  },
  
  async getRuneBalance(runeId) {
    return axios.get(`${ORDPI_API_BASE}/runes/${runeId}/balance`);
  },

  async initiateRuneTransfer(fromAddress, toAddress, amount, runeId, signatures) {
    // runeId is optional, defaults to OVT on the backend if not provided
    return axios.post(`${ORDPI_API_BASE}/runes/transfer`, {
      fromAddress,
      toAddress,
      amount,
      runeId, // Optional: OrdPi backend can default to OVT_RUNE_ID if null/undefined
      signatures // For multi-sig authorization if needed for transfers
    });
  },
  
  // Add other Ord/Rune related API calls
};

module.exports = remoteApiService;
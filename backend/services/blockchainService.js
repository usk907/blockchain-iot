const fs = require("fs");
const path = require("path");
const { Web3 } = require("web3");

const RPC_URL = process.env.WEB3_RPC_URL || "http://127.0.0.1:7545";
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x5c4C0c922c9023cd211c934049043c091F0aC024";
const ABI_PATH = process.env.IOTDATA_ABI_PATH
  ? path.resolve(process.env.IOTDATA_ABI_PATH)
  : path.resolve(__dirname, "..", "IoTDataABI.json");

let web3Instance;
let contractInstance;

function loadAbi() {
  const raw = fs.readFileSync(ABI_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.abi) ? parsed.abi : parsed;
}

function getWeb3() {
  if (!web3Instance) {
    web3Instance = new Web3(RPC_URL);
  }
  return web3Instance;
}

function getContract() {
  if (!contractInstance) {
    const web3 = getWeb3();
    const abi = loadAbi();
    contractInstance = new web3.eth.Contract(abi, CONTRACT_ADDRESS);
  }
  return contractInstance;
}

async function getAccounts() {
  const web3 = getWeb3();
  return web3.eth.getAccounts();
}

async function registerDevice(deviceAddress, fromAccount) {
  const contract = getContract();
  return contract.methods.registerDevice(deviceAddress).send({ from: fromAccount });
}

async function storeDataHash(cid, fromAccount, gas = 300000) {
  const contract = getContract();
  return contract.methods.storeDataHash(cid).send({ from: fromAccount, gas });
}

module.exports = {
  RPC_URL,
  CONTRACT_ADDRESS,
  getWeb3,
  getContract,
  getAccounts,
  registerDevice,
  storeDataHash,
};

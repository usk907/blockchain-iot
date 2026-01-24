const { Web3 } = require("web3");

const fs = require("fs");

const web3 = new Web3("http://127.0.0.1:7545");

const artifact = JSON.parse(fs.readFileSync("./IoTDataABI.json"));
const contractAddress = "0x5c4C0c922c9023cd211c934049043c091F0aC024";

const contract = new web3.eth.Contract(artifact.abi, contractAddress);

async function register(deviceAddress) {
  const accounts = await web3.eth.getAccounts();
  const admin = accounts[0];

  await contract.methods.registerDevice(deviceAddress).send({ from: admin });

  console.log("Device registered:", deviceAddress);
}

register("0xE2C07B2ABbee8aCdbB4Ba675E7872676580127e3");

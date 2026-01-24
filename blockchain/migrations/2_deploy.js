const IoTData = artifacts.require("IoTData");

module.exports = function (deployer) {
  deployer.deploy(IoTData);
};

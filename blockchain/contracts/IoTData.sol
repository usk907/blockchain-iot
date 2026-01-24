// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract IoTData {

    address public owner;

    enum Role { NONE, DEVICE, USER, ADMIN }

    struct Entity {
        Role role;
        bool active;
    }

    mapping(address => Entity) public entities;
    mapping(uint256 => string) public dataHashes;
    uint256 public dataCount;

    event Registered(address entity, Role role);
    event DataStored(uint256 id, string cid, address device);

    constructor() {
        owner = msg.sender;
        entities[msg.sender] = Entity(Role.ADMIN, true);
    }

    modifier onlyAdmin() {
        require(entities[msg.sender].role == Role.ADMIN, "Not admin");
        _;
    }

    modifier onlyDevice() {
        require(entities[msg.sender].role == Role.DEVICE, "Not device");
        _;
    }

    function registerDevice(address device) public onlyAdmin {
        entities[device] = Entity(Role.DEVICE, true);
        emit Registered(device, Role.DEVICE);
    }

    function storeDataHash(string memory cid) public onlyDevice {
        dataCount++;
        dataHashes[dataCount] = cid;
        emit DataStored(dataCount, cid, msg.sender);
    }
}

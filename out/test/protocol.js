"use strict";
const test = require("blue-tape");
const hose_1 = require("../hose");
const TPH = require("torrent-piece-handler");
let id = "-EM0022-PEANUTS4AITH";
test("Not Interested (1)", function (t) {
    t.plan(1);
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("close", () => {
        t.false(hose.isActive, "Check the isActive flag");
    });
    hose.sendHandshake();
    hose.sendNotInterested();
});
test("Interested (2)", function (t) {
    t.plan(2);
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    let hose2 = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose2.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose2).pipe(hose);
    hose.on("interested", () => {
        t.false(hose.choked, "Check the choked flag");
    });
    hose2.on("interested", () => {
        t.false(hose.choked, "Check the choked flag");
    });
    hose.sendHandshake();
    hose2.sendHandshake();
    hose.sendInterested();
});
test("Have (1)", function (t) {
    t.plan(1);
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("have", (index) => {
        t.equal(index, 1, "Check the index is correct");
    });
    hose.sendHandshake();
    hose.sendHave(1);
});
test("Have large number (1)", function (t) {
    t.plan(1);
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("have", (index) => {
        t.equal(index, 17947, "Check the index is correct");
    });
    hose.sendHandshake();
    hose.sendHave(17947);
});
test("Bitfield (1)", function (t) {
    t.plan(1);
    let buffer = Buffer.from('40', 'hex');
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("bitfield", (bits) => {
        t.equal(bits.toString('hex'), buffer.toString('hex'), "equality of bits");
    });
    hose.sendHandshake();
    hose.sendInterested();
    hose.sendBitfield(buffer);
});
test("Request (15)", function (t) {
    t.plan(15);
    let interval = 0;
    const files = [{ path: 'Downloads/lol1/1.png',
            name: '1.png',
            length: 255622,
            offset: 0 },
        { path: 'Downloads/lol2/2.png',
            name: '2.png',
            length: 1115627,
            offset: 255622 }];
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("request", () => {
        interval++;
        if (interval === 5) {
            t.equal(hose.inRequests[0].index, 0, "Check the index is correct");
            t.equal(hose.inRequests[0].begin, 16384 * 0, "Check the begin is correct");
            t.equal(hose.inRequests[0].length, 16384, "Check the length is correct");
            t.equal(hose.inRequests[1].index, 0, "Check the index is correct");
            t.equal(hose.inRequests[1].begin, 16384 * 1, "Check the begin is correct");
            t.equal(hose.inRequests[1].length, 16384, "Check the length is correct");
            t.equal(hose.inRequests[2].index, 0, "Check the index is correct");
            t.equal(hose.inRequests[2].begin, 16384 * 2, "Check the begin is correct");
            t.equal(hose.inRequests[2].length, 16384, "Check the length is correct");
            t.equal(hose.inRequests[3].index, 0, "Check the index is correct");
            t.equal(hose.inRequests[3].begin, 16384 * 3, "Check the begin is correct");
            t.equal(hose.inRequests[3].length, 16384, "Check the length is correct");
            t.equal(hose.inRequests[4].index, 0, "Check the index is correct");
            t.equal(hose.inRequests[4].begin, 16384 * 4, "Check the begin is correct");
            t.equal(hose.inRequests[4].length, 16384, "Check the length is correct");
        }
        else {
            return;
        }
    });
    hose.sendHandshake();
    hose.sendInterested();
    let tph = new TPH.default(files, 962416635, 1048576, 918, 872443);
    tph.prepareRequest(0, (buf, count) => {
        hose.sendRequest(buf, count);
    });
});
test("Cancel (3)", function (t) {
    t.plan(3);
    let buffer = Buffer.from('40', 'hex');
    let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
    hose.on("error", (err) => { t.fail(err.toString()); });
    hose.pipe(hose);
    hose.on("cancel", (index, begin, length) => {
        t.equal(index, 0, "equality index");
        t.equal(begin, 16384 * 2, "equality begin");
        t.equal(length, 16384, "equality length");
    });
    hose.sendHandshake();
    hose.sendInterested();
    hose.sendCancel(0, 16384 * 2, 16384);
});

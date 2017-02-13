"use strict";
const stream_1 = require("stream");
const inherits = require("inherits");
const buffer_1 = require("buffer");
const crypto_1 = require("crypto");
const debug = require("debug")("hose"), UTmetadata = require("ut-extensions").UTmetadata, UTpex = require("ut-extensions").UTpex;
const speedometer = require("speedometer"), bencode = require("bencode"), BITFIELD_MAX_SIZE = 100000, KEEP_ALIVE_TIMEOUT = 55000, DL_SIZE = 16384;
const PROTOCOL = buffer_1.Buffer.from("BitTorrent protocol"), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x05, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x08]), PORT = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x03, 0x09]), EXTENDED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]), EXT_PROTOCOL = { "m": { "ut_pex": 1, "ut_metadata": 2 } }, UT_PEX = 1, UT_METADATA = 2;
inherits(Hose, stream_1.Duplex);
function Hose(infoHash, myID, options) {
    stream_1.Duplex.call(this);
    const self = this;
    self._debugId = ~~((Math.random() * 100000) + 1);
    self._debug("Begin debugging");
    self.destroyed = false;
    self.uploadSpeed = speedometer();
    self.downloadSpeed = speedometer();
    self.bufferSize = 0;
    self.streamStore = [];
    self.parseSize = 0;
    self.actionStore = null;
    self.inRequests = [];
    self.blocks = [];
    self.blockCount = 0;
    self.pieceHash = null;
    self.infoHash = infoHash;
    self.myID = myID;
    self.peerID = null;
    self.peerHasExt = false;
    self.peerHasDHT = false;
    self.choked = true;
    self.interested = false;
    self.busy = false;
    self.reqBusy = false;
    self.meta = true;
    self.ext = {};
    self.metaHandshake = null;
    if (options) {
        if (options.metadata_handshake)
            self.metaHandshake = options.metadata_handshake;
    }
    self.prepHandshake();
}
Hose.prototype.prepHandshake = function () {
    const self = this;
    self._nextAction(1, (payload) => {
        let pstrlen = payload.readUInt8(0);
        self._nextAction(pstrlen + 48, (payload) => {
            self._debug("Recieved Hanshake");
            let pstr = payload.slice(0, pstrlen), reserved = payload.slice(pstrlen, pstrlen + 8);
            pstr = pstr.toString();
            payload = payload.slice(pstrlen + 8);
            let infoHash = payload.slice(0, 20), peerID = payload.slice(20, 40);
            self.peerID = peerID.toString();
            if (pstr !== "BitTorrent protocol" || infoHash.toString("hex") !== self.infoHash)
                self.closeConnection();
            if (!!(reserved[5] & 0x10)) {
                self._debug("peer has extended");
                self.peerHasExt = true;
            }
            if (!!(reserved[7] & 0x01)) {
                self._debug("peer has dht");
                self.peerHasDHT = true;
            }
            self._debug(`infoHash: ${infoHash.toString("hex")}, peerID: ${self.peerID}`);
            self.emit("handshake", infoHash, peerID);
            self.nextAction();
        });
    });
};
Hose.prototype.nextAction = function () {
    const self = this;
    self._nextAction(4, (payload) => {
        let length = payload.readUInt32BE(0);
        if (length > 0)
            self._nextAction(length, self.handleCode);
        else
            self.nextAction();
    });
};
Hose.prototype._read = function () { };
Hose.prototype._write = function (payload, encoding, next) {
    const self = this;
    self._debug(`incoming size:`, payload.length);
    self.downloadSpeed(payload.length);
    self.bufferSize += payload.length;
    self.streamStore.push(payload);
    while (self.bufferSize >= self.parseSize) {
        let buf = (self.streamStore.length > 1)
            ? buffer_1.Buffer.concat(self.streamStore)
            : self.streamStore[0];
        self.bufferSize -= self.parseSize;
        self.streamStore = (self.bufferSize)
            ? [buf.slice(self.parseSize)]
            : [];
        self.actionStore(buf.slice(0, self.parseSize));
    }
    next(null);
};
Hose.prototype._push = function (payload) {
    this._debug("sending payload", payload.length);
    return this.push(payload);
};
Hose.prototype.sendKeepActive = function () {
    this._debug("sending keep Alive");
    this._push(KEEP_ALIVE);
};
Hose.prototype.sendHandshake = function () {
    this._debug("sending handshake");
    let infoHashBuffer, peerIDbuffer;
    (!buffer_1.Buffer.isBuffer(this.infoHash))
        ? infoHashBuffer = buffer_1.Buffer.from(this.infoHash, "hex")
        : infoHashBuffer = this.infoHash;
    (!buffer_1.Buffer.isBuffer(this.myID))
        ? peerIDbuffer = buffer_1.Buffer.from(this.myID)
        : peerIDbuffer = this.myID;
    this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
    this._sendMetaHandshake();
};
Hose.prototype.sendNotInterested = function () {
    this._debug("sending not interested");
    this._push(UNINTERESTED);
};
Hose.prototype.sendInterested = function () {
    this._debug("sending interested");
    this._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
    this.choked = false;
};
Hose.prototype.sendHave = function (index) {
    this._debug("send have");
    let buf = new buffer_1.Buffer(4);
    buf.writeUInt32BE(index, 0);
    this._push(buffer_1.Buffer.concat([HAVE, buf]));
};
Hose.prototype.sendBitfield = function (bitfield) {
    this._debug("sending bitfield");
    let bitfieldBuf = buffer_1.Buffer.from(bitfield, "hex");
    let bf = BITFIELD;
    bf.writeUInt32BE(bitfieldBuf.length + 1, 0);
    this._push(buffer_1.Buffer.concat([bf, bitfieldBuf]));
};
Hose.prototype.sendRequest = function (payload, count) {
    this._debug("sending request");
    const self = this;
    self.blockCount = count;
    self.busy = true;
    self.pieceHash = crypto_1.createHash("sha1");
    this._push(payload);
};
Hose.prototype.sendPiece = function (piece) {
    this._debug("sending piece");
    this._push(piece);
};
Hose.prototype.sendCancel = function (index, begin, length) {
    this._debug("sending cancel");
    let buf = new buffer_1.Buffer(12);
    buf.writeUInt32BE(index, 0);
    buf.writeUInt32BE(begin, 4);
    buf.writeUInt32BE(length, 8);
    this._push(buffer_1.Buffer.concat([CANCEL, buf]));
};
Hose.prototype._nextAction = function (length, action) {
    this.parseSize = length;
    this.actionStore = action;
};
Hose.prototype._onHave = function (pieceIndex) {
    this.emit("have", pieceIndex);
};
Hose.prototype._onBitfield = function (payload) {
    this.emit("bitfield", payload);
};
Hose.prototype._onRequest = function (index, begin, length) {
    this.inRequests.push({ index, begin, length });
    this.emit("request");
};
Hose.prototype._onPiece = function (index, begin, block) {
    const self = this;
    process.nextTick(() => {
        self.blockCount--;
        self.blocks[begin / DL_SIZE] = block;
        if (!self.blockCount) {
            let resultBuf = buffer_1.Buffer.concat(self.blocks);
            self.pieceHash.update(resultBuf);
            self.emit("finished_piece", index, resultBuf, self.pieceHash);
            self.blocks = [];
        }
    });
};
Hose.prototype._onCancel = function (index, begin, length) {
    this.emit("cancel", index, begin, length);
};
Hose.prototype._sendMetaHandshake = function () {
    if (this.metaHandshake && this.peerHasExt)
        this.metaDataHandshake(this.metaHandshake);
    else
        this.metaDataHandshake();
};
Hose.prototype._onExtension = function (extensionID, payload) {
    const self = this;
    if (extensionID === 0) {
        self._debug("extension handshake");
        let obj = bencode.decode(payload);
        let m = obj.m;
        if (m["ut_metadata"]) {
            self.ext[UT_METADATA] = new UTmetadata(obj.metadata_size, self.infoHash);
            self.ext["ut_metadata"] = m["ut_metadata"];
            self.ext[UT_METADATA].on("next", (piece) => {
                let request = { "msg_type": 0, "piece": piece }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
                prepRequest.writeUInt32BE(requestEn.length + 2, 0);
                code.writeUInt8(self.ext["ut_metadata"], 0);
                let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
                this._push(requestBuf);
            });
            self.ext[UT_METADATA].on("metadata", (torrent) => {
                self.emit("metadata", torrent);
            });
        }
        if (m["ut_pex"]) {
            self.ext[UT_PEX] = new UTpex();
            self.ext["ut_pex"] = m["ut_pex"];
            self.ext[UT_PEX].on("pex_added", (peers) => {
                self.emit("pex_added", peers);
            });
            self.ext[UT_PEX].on("pex_added6", (peers) => {
                self.emit("pex_added6", peers);
            });
            self.ext[UT_PEX].on("pex_dropped", (peers) => {
                self.emit("pex_dropped", peers);
            });
            self.ext[UT_PEX].on("pex_dropped6", (peers) => {
                self.emit("pex_dropped6", peers);
            });
        }
    }
    else {
        if (self.meta || extensionID === self.ext["ut_pex"])
            self.ext[extensionID]._message(payload);
    }
};
Hose.prototype.metaDataRequest = function () {
    const self = this;
    if (self.ext["ut_metadata"]) {
        self.metaDataHandshake();
        let request = { "msg_type": 0, "piece": 0 }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
        prepRequest.writeUInt32BE(requestEn.length + 2, 0);
        code.writeUInt8(self.ext["ut_metadata"], 0);
        let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
        this._push(requestBuf);
    }
};
Hose.prototype.metaDataHandshake = function (msg) {
    this._debug("sending meta_handshake");
    let handshake = (msg) ? msg : EXT_PROTOCOL, prepHandshake = EXTENDED, handshakeEn = bencode.encode(handshake);
    prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
    let handshakeBuf = buffer_1.Buffer.concat([prepHandshake, buffer_1.Buffer.from([0x00]), handshakeEn]);
    this._push(handshakeBuf);
};
Hose.prototype.handleCode = function (payload) {
    const self = this;
    self.nextAction();
    switch (payload[0]) {
        case 0:
            self._debug("got choke");
            self.choked = true;
            self._push(CHOKE);
            break;
        case 1:
            self._debug("got unchoke");
            if (self.choked) {
                self.choked = false;
                self._push(UNCHOKE);
            }
            break;
        case 2:
            self._debug("peer is interested");
            self.emit("interested");
            if (self.choked) {
                self.choked = false;
                self._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
            }
            break;
        case 3:
            self._debug("peer is uninterested");
            self.closeConnection();
            break;
        case 4:
            self._debug("peer sent have");
            self._onHave(payload.readUInt32BE(1));
            break;
        case 5:
            self._debug("Recieved bitfield");
            self._onBitfield(payload.slice(1));
            break;
        case 6:
            if (self.choked)
                return;
            self._debug("Recieved request");
            self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
            break;
        case 7:
            self._debug("Recieved piece");
            self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
            break;
        case 8:
            self._debug("Recieved cancel");
            self._onCancel(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
            break;
        case 20:
            self._debug("Extension Protocol");
            self._onExtension(payload.readUInt8(1), payload.slice(2));
            break;
        default:
            this._debug("error, wrong message");
    }
};
Hose.prototype.isChoked = function () {
    return this.choked;
};
Hose.prototype.isBusy = function () {
    return this.busy;
};
Hose.prototype.setBusy = function () {
    this.busy = true;
};
Hose.prototype.unsetBusy = function () {
    this.busy = false;
};
Hose.prototype.closeConnection = function () {
    this._debug("CLOSE CONNECTION");
    this.isActive = false;
    this.emit("close");
};
Hose.prototype.removeMeta = function () {
    this.meta = false;
    this.ext[UT_METADATA] = null;
    delete this.ext[UT_METADATA];
};
Hose.prototype.removePex = function () {
    this.ext[UT_PEX] = null;
    delete this.ext[UT_PEX];
};
Hose.prototype._debug = function (...args) {
    args[0] = "[" + this._debugId + "] " + args[0];
    debug.apply(null, args);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;

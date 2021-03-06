"use strict";
const stream_1 = require("stream");
const inherits = require("inherits");
const buffer_1 = require("buffer");
const crypto_1 = require("crypto");
const debug = require("debug")("hose"), UTmetadata = require("ut-extensions").UTmetadata, UTpex = require("ut-extensions").UTpex;
const speedometer = require("speedometer"), bencode = require("bencode"), BITFIELD_MAX_SIZE = 100000, KEEP_ALIVE_TIMEOUT = 55000, DL_SIZE = 16384;
const PROTOCOL = buffer_1.Buffer.from("BitTorrent protocol"), RESERVED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]), KEEP_ALIVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x00]), CHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), UNCHOKE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), INTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), UNINTERESTED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), HAVE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x04]), BITFIELD = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), REQUEST = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), PIECE = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), CANCEL = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x08]), PORT = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x03, 0x09]), EXTENDED = buffer_1.Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]), EXT_PROTOCOL = { "m": { "ut_pex": 1, "ut_metadata": 2 } }, UT_PEX = 1, UT_METADATA = 2;
inherits(Hose, stream_1.Duplex);
function Hose(infoHash, peerID, options) {
    stream_1.Duplex.call(this);
    const self = this;
    self._debugId = ~~((Math.random() * 100000) + 1);
    self._debug("Begin debugging");
    self.defaultEncoding = 'utf8';
    self.destroyed = false;
    self.sentHandshake = false;
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
    self.peerID = peerID;
    self.choked = true;
    self.interested = false;
    self.busy = false;
    self.reqBusy = false;
    self.meta = true;
    self.ext = {};
    self.prepHandshake();
}
Hose.prototype.prepHandshake = () => {
    this._nextAction(1, (payload) => {
        let pstrlen = payload.readUInt8(0);
        this._nextAction(pstrlen + 48, (payload) => {
            this._debug("prepHandshake Engaged");
            let pstr = payload.slice(0, pstrlen), reserved = payload.slice(pstrlen, 8);
            pstr = pstr.toString();
            payload = payload.slice(pstrlen + 8);
            let infoHash = payload.slice(0, 20), peerID = payload.slice(20, 40);
            this.infoHash = infoHash.toString("hex");
            this.peerID = peerID.toString();
            if (pstr !== "BitTorrent protocol")
                return;
            this._debug(`infoHash: ${this.infoHash}, peerID: ${this.peerID}`);
            if (!this.sentHandshake)
                this.emit("handshake", this.infoHash, this.peerID);
            this.nextAction();
        });
    });
};
Hose.prototype.nextAction = () => {
    this._nextAction(4, (payload) => {
        let length = payload.readUInt32BE(0);
        if (length > 0)
            this._nextAction(length, this.handleCode);
        else
            this.nextAction();
    });
};
Hose.prototype._read = () => { };
Hose.prototype._write = (payload, encoding, next) => {
    this._debug(`incoming size:`, payload.length);
    this.downloadSpeed(payload.length);
    this.bufferSize += payload.length;
    this.streamStore.push(payload);
    while (this.bufferSize >= this.parseSize) {
        let buf = (this.streamStore.length > 1)
            ? buffer_1.Buffer.concat(this.streamStore)
            : this.streamStore[0];
        this.bufferSize -= this.parseSize;
        this.streamStore = (this.bufferSize)
            ? [buf.slice(this.parseSize)]
            : [];
        this.actionStore(buf.slice(0, this.parseSize));
    }
};
Hose.prototype._push = (payload) => {
    return this.push(payload);
};
Hose.prototype.sendKeepActive = () => {
    this._push(KEEP_ALIVE);
};
Hose.prototype.sendHandshake = () => {
    this.sentHandshake = true;
    let infoHashBuffer = buffer_1.Buffer.from(this.infoHash, "hex"), peerIDbuffer = buffer_1.Buffer.from(this.peerID);
    this._push(buffer_1.Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
};
Hose.prototype.sendNotInterested = () => {
    this._push(UNINTERESTED);
};
Hose.prototype.sendInterested = () => {
    this._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
    this.choked = false;
};
Hose.prototype.sendHave = (index) => {
};
Hose.prototype.sendBitfield = (bitfield) => {
    let bitfieldBuf = buffer_1.Buffer.from(bitfield, "hex");
    let bf = BITFIELD;
    bf.writeUInt32BE(bitfieldBuf.length + 1, 0);
    this._push(buffer_1.Buffer.concat([bf, bitfieldBuf]));
};
Hose.prototype.sendRequest = (payload, count) => {
    const self = this;
    self.blockCount = count;
    self.busy = true;
    self.pieceHash = crypto_1.createHash("sha1");
    this._push(payload);
};
Hose.prototype.sendPiece = (piece) => {
    this._push(piece);
};
Hose.prototype.sendCancel = () => {
};
Hose.prototype._nextAction = (length, action) => {
    this.parseSize = length;
    this.actionStore = action;
};
Hose.prototype._onHave = (pieceIndex) => {
    this.emit("have", pieceIndex);
};
Hose.prototype._onBitfield = (payload) => {
    this.emit("bitfield", payload);
};
Hose.prototype._onRequest = (index, begin, length) => {
    this.inRequests.push({ index, begin, length });
    this.emit("request");
};
Hose.prototype._onPiece = (index, begin, block) => {
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
Hose.prototype._onCancel = (index, begin, length) => {
};
Hose.prototype._onExtension = (extensionID, payload) => {
    const self = this;
    if (extensionID === 0) {
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
Hose.prototype.metaDataRequest = () => {
    const self = this;
    if (self.ext["ut_metadata"]) {
        self.metaDataHandshake();
        let request = { "msg_type": 0, "piece": 0 }, prepRequest = EXTENDED, requestEn = bencode.encode(request), code = new buffer_1.Buffer(1);
        prepRequest.writeUInt32BE(requestEn.length + 2, 0);
        code.writeUInt8(self.ext["ut_metadata"], 0);
        let requestBuf = buffer_1.Buffer.concat([prepRequest, code, requestEn]);
        console.log("metadata request");
        this._push(requestBuf);
    }
};
Hose.prototype.metaDataHandshake = () => {
    let handshake = EXT_PROTOCOL, prepHandshake = EXTENDED, handshakeEn = bencode.encode(handshake);
    prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
    let handshakeBuf = buffer_1.Buffer.concat([prepHandshake, buffer_1.Buffer.from([0x00]), handshakeEn]);
    this._push(handshakeBuf);
};
Hose.prototype.handleCode = (payload) => {
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
            if (!self.choked) {
            }
            else {
                self.choked = false;
                self._push(UNCHOKE);
            }
            break;
        case 2:
            self._debug("peer is interested");
            self.emit("interested");
            self.choked = false;
            self._push(buffer_1.Buffer.concat([INTERESTED, UNCHOKE]));
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
        default:
            this._debug("error, wrong message");
    }
};
Hose.prototype.isChoked = () => {
    return this.choked;
};
Hose.prototype.isBusy = () => {
    return this.busy;
};
Hose.prototype.setBusy = () => {
    this.busy = true;
};
Hose.prototype.unsetBusy = () => {
    this.busy = false;
};
Hose.prototype.closeConnection = () => {
    this.isActive = false;
    this.emit("close");
};
Hose.prototype.removeMeta = () => {
    this.meta = false;
    this.ext[UT_METADATA] = null;
    delete this.ext[UT_METADATA];
};
Hose.prototype.close = () => {
};
Hose.prototype._debug = (...args) => {
    args[0] = "[" + this._debugId + "] " + args[0];
    debug.apply(null, args);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Hose;

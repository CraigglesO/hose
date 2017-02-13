"use strict";

/***********************************************************
 * Sources:
 * https://wiki.theory.org/BitTorrentSpecification#Handshake
 * http://www.bittorrent.org/beps/bep_0003.html
 ***********************************************************/

import { Duplex } from "stream";
import * as inherits from "inherits";
import { Buffer } from "buffer";
import { Hash, createHash } from "crypto";

const debug      = require("debug")("hose"),
      UTmetadata = require("ut-extensions").UTmetadata,
      UTpex      = require("ut-extensions").UTpex;

/** Outsorced Dependencies **/
const speedometer = require("speedometer"),
      bencode     = require("bencode"),

      BITFIELD_MAX_SIZE  = 100000, // Size of field for preporations
      KEEP_ALIVE_TIMEOUT = 55000,  // 55 seconds
      DL_SIZE = 16384;

const PROTOCOL     = Buffer.from("BitTorrent protocol"),
      RESERVED     = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]),
      KEEP_ALIVE   = Buffer.from([0x00, 0x00, 0x00, 0x00]),       // keep-alive: <len=0000>
      CHOKE        = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]), // choke: <len=0001><id=0>
      UNCHOKE      = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]), // unchoke: <len=0001><id=1>
      INTERESTED   = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02]), // <len=0001><id=2>
      UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03]), // <len=0001><id=3>
      HAVE         = Buffer.from([0x00, 0x00, 0x00, 0x05, 0x04]), // <len=0005><id=4><piece index>
      BITFIELD     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x05]), // <len=0001+X><id=5><bitfield>
      REQUEST      = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x06]), // <len=0013><id=6><index><begin><length> Requests are 1 code and 3 32 bit integers
      PIECE        = Buffer.from([0x00, 0x00, 0x00, 0x09, 0x07]), // <len=0009+X><id=7><index><begin><block> Pieces are 1 code and 2 16 bit integers and then the piece...
      CANCEL       = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x08]), // <len=0013><id=8><index><begin><length>
      PORT         = Buffer.from([0x00, 0x00, 0x00, 0x03, 0x09]), // <len=0003><id=9><listen-port>
      EXTENDED     = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x14]), // <len=0002+X><id=20><ext_id><ext_msg>
      EXT_PROTOCOL = { "m": {"ut_pex": 1, "ut_metadata": 2} },
      UT_PEX       = 1,
      UT_METADATA  = 2;

interface Extension {
  "ut_pex":      number;
  "ut_metadata": number;
}

interface Request {
  index:  number;
  begin:  number;
  length: number;
}

interface Options {
  "metadata_handshake": MetadataHandshake;
}

interface MetadataHandshake {
  "ipv4":          Buffer;
  "ipv6":          Buffer;
  "m": {
     ut_metadata:  number;
     ut_pex:       number;
   };
  "metadata_size": number;
  "p":             number;
  "reqq":          number;
  "v":             Buffer;
  "yourip":        Buffer;
}

inherits(Hose, Duplex);

function Hose(infoHash: string | Buffer, myID: string | Buffer, options?: Options) {
    Duplex.call(this);
    const self = this;

    self._debugId       = ~~((Math.random() * 100000) + 1);
    self._debug("Begin debugging");

    self.destroyed       = false;
    self.uploadSpeed     = speedometer();
    self.downloadSpeed   = speedometer();
    self.bufferSize      = 0;
    self.streamStore     = [];
    self.parseSize       = 0;
    self.actionStore     = null;
    self.inRequests      = [];
    self.blocks          = [];
    self.blockCount      = 0;
    self.pieceHash       = null;

    self.infoHash        = infoHash;
    self.myID            = myID;
    self.peerID          = null;
    self.peerHasExt      = false;
    self.peerHasDHT      = false;
    self.choked          = true;
    self.interested      = false;
    self.busy            = false;
    self.reqBusy         = false;
    self.meta            = true;
    self.ext             = {};
    self.metaHandshake   = null;

    if (options) {
      if (options.metadata_handshake)
        self.metaHandshake = options.metadata_handshake;
    }

    self.prepHandshake();
  }



// HANDSHAKE:
Hose.prototype.prepHandshake = function () {
  const self = this;
  self._nextAction(1, (payload) => {
    let pstrlen = payload.readUInt8(0);
    self._nextAction(pstrlen + 48, (payload) => {
      // Prepare all information
      self._debug("Recieved Hanshake");
      let pstr          = payload.slice(0, pstrlen),             // Protocol Identifier utf-8 encoding
          reserved      = payload.slice(pstrlen, pstrlen + 8);   // These 8 bytes are reserved for future use
          pstr          = pstr.toString();                       // Convert the Protocol to a string
          payload       = payload.slice(pstrlen + 8);            // Remove the pre-string and reserved bytes from buffer
      let infoHash      = payload.slice(0, 20),
          peerID        = payload.slice(20, 40);
          self.peerID   = peerID.toString();                      // PeerID is also a hex string

      if (pstr !== "BitTorrent protocol" || infoHash.toString("hex") !== self.infoHash)
        self.closeConnection();

      if ( !!(reserved[5] & 0x10) ) {
        self._debug("peer has extended");
        self.peerHasExt = true;
      }
      if ( !!(reserved[7] & 0x01) ) {
        self._debug("peer has dht");
        self.peerHasDHT = true;
      }

      // Send a handshake back if peer initiated the connection
      self._debug(`infoHash: ${infoHash.toString("hex")}, peerID: ${self.peerID}`);
      self.emit("handshake", infoHash, peerID);      // Let listeners know the peers requested infohash and ID

      // Last but not least let's add a new action to the queue
      self.nextAction();
    });
  });
};

Hose.prototype.nextAction = function() {
  const self = this;
  // TODO: upate keep alive timer here.
  self._nextAction(4, (payload) => {
    let length = payload.readUInt32BE(0);          // Get the length of the payload.
    if (length > 0)
      self._nextAction(length, self.handleCode);      // Message length, next action is to parse the information provided
    else
      self.nextAction();
  });
};

/** All built in functionality goes here: **/

// Read streams will all be handled with this.push
Hose.prototype._read = function() {};
/** Handling incoming messages with message length (this.parseSize)
 ** and cueing up commands to handle the message (this.actionStore) **/
Hose.prototype._write = function(payload: Buffer, encoding: string, next: Function) {
  const self = this;
  self._debug(`incoming size:`, payload.length);
  self.downloadSpeed(payload.length);
  self.bufferSize += payload.length;                 // Increase our buffer size count, we have more data
  self.streamStore.push(payload);                    // Add the payload to our list of streams downloaded
  // Parse Size is always pre-recorded, because we know what to expect from peers
  while (self.bufferSize >= self.parseSize) {        // Wait until the package size fits the crime
    let buf = (self.streamStore.length > 1)          // Store our stream to a buffer to do the crime
      ? Buffer.concat(self.streamStore)
      : self.streamStore[0];
    self.bufferSize -= self.parseSize;               // Decrease the size of our store count, self number of data is processed
    self.streamStore = (self.bufferSize)             // If buffersize is zero, reset the buffer; otherwise just slice the part we are going to use
      ? [buf.slice(self.parseSize)]
      : [];
    self.actionStore(buf.slice(0, self.parseSize));  // Let us run the code we have!
  }
  // send a null to let stream know we are done and ready for the next input.
  next(null);
};

/** ALL OUTGOING GOES HERE:  **/

Hose.prototype._push = function(payload: Buffer) {
  // TODO: upate keep alive timer here.
  this._debug("sending payload", payload.length);
  return this.push(payload);
};
// keep-alive: <len=0000>
Hose.prototype.sendKeepActive = function() {
  this._debug("sending keep Alive");
  this._push(KEEP_ALIVE);
};
// handshake: <pstrlen><pstr><reserved><info_hash><peer_id>
Hose.prototype.sendHandshake = function() {
  this._debug("sending handshake");
  // convert infoHash and peerID to buffer
  let infoHashBuffer, peerIDbuffer;
  (!Buffer.isBuffer(this.infoHash))
    ? infoHashBuffer = Buffer.from(this.infoHash, "hex")
    : infoHashBuffer = this.infoHash;
  (!Buffer.isBuffer(this.myID))
    ? peerIDbuffer   = Buffer.from(this.myID)
    : peerIDbuffer   = this.myID;
  this._push(Buffer.concat([PROTOCOL, RESERVED, infoHashBuffer, peerIDbuffer]));
  this._sendMetaHandshake();
};
// not interested: <len=0001><id=3>
Hose.prototype.sendNotInterested = function() {
  this._debug("sending not interested");
  this._push(UNINTERESTED);
};
// interested: <len=0001><id=2>
Hose.prototype.sendInterested = function() {
  this._debug("sending interested");
  this._push(Buffer.concat([INTERESTED, UNCHOKE]));
  this.choked = false;
};
// have: <len=0005><id=4><piece index>
Hose.prototype.sendHave = function(index: number) {
  this._debug("send have");
  let buf = new Buffer(4);
  buf.writeUInt32BE(index, 0);
  this._push(Buffer.concat([HAVE, buf]));
};
// bitfield: <len=0001+X><id=5><bitfield>
Hose.prototype.sendBitfield = function(bitfield: string) {
  // update bitfield length param to bitfield size:
  this._debug("sending bitfield");
  let bitfieldBuf = Buffer.from(bitfield, "hex");
  let bf = BITFIELD;
  bf.writeUInt32BE(bitfieldBuf.length + 1, 0);
  this._push( Buffer.concat([bf, bitfieldBuf]) );
};
// request: <len=0013><id=6><index><begin><length>
Hose.prototype.sendRequest = function(payload: Buffer, count: number) {
  this._debug("sending request");
  const self      = this;
  // Track how many incoming we are going to get:
  self.blockCount = count;
  self.busy       = true;
  // Create a new hash to ensure authenticity
  self.pieceHash  = createHash("sha1");
  this._push(payload);
};
// piece: <len=0009+X><id=7><index><begin><block>
Hose.prototype.sendPiece = function(piece: Buffer) {
  this._debug("sending piece");
  this._push(piece);
};
// cancel: <len=0013><id=8><index><begin><length>
Hose.prototype.sendCancel = function(index: number, begin: number, length: number) {
  this._debug("sending cancel");
  let buf = new Buffer(12);
  buf.writeUInt32BE(index, 0);
  buf.writeUInt32BE(begin, 4);
  buf.writeUInt32BE(length, 8);
  this._push( Buffer.concat([CANCEL, buf]) );
};

/** ALL INCOMING GOES HERE: **/

Hose.prototype._nextAction = function(length: number, action: Function) {
  this.parseSize   = length;
  this.actionStore = action;
};
// have: <len=0005><id=4><piece index>
Hose.prototype._onHave = function(pieceIndex) {
  this.emit("have", pieceIndex);
};
// bitfield: <len=0001+X><id=5><bitfield>
Hose.prototype._onBitfield = function(payload) {
  // Here we have recieved a bitfield (first message)
  this.emit("bitfield", payload);
};
// request: <len=0013><id=6><index><begin><length>
Hose.prototype._onRequest = function(index, begin, length) {
  // Add the request to the stack:
  this.inRequests.push({index, begin, length});
  this.emit("request");
};
// piece: <len=0009+X><id=7><index><begin><block>
Hose.prototype._onPiece = function(index: number, begin: number, block: Buffer) {
  const self = this;
  process.nextTick(() => {
    self.blockCount--;
    // Commit piece to total. We wait to concat the buffers due to speed concerns
    self.blocks[begin / DL_SIZE] = block;
    // If we have all the blocks we need to make a piece send it up to torrentEngine:
    if (!self.blockCount) {
      let resultBuf = Buffer.concat(self.blocks);
      // Update hash:
      self.pieceHash.update(resultBuf);
      // Emit up:
      self.emit("finished_piece", index, resultBuf, self.pieceHash);
      self.blocks = [];
    }
  });
};
// cancel: <len=0013><id=8><index><begin><length>
Hose.prototype._onCancel = function(index, begin, length) {
  this.emit("cancel", index, begin, length);
};

/** ALL EXTENSIONS GO HERE **/

// metaHandshake: <len=0002+X><id=20><ext_id=0><ext_msg>
Hose.prototype._sendMetaHandshake = function() {
  if (this.metaHandshake && this.peerHasExt)
    this.metaDataHandshake(this.metaHandshake);
  else
    this.metaDataHandshake();
};
// extension: <len=0002+x><id=20><ext_ID><ext_msg>
Hose.prototype._onExtension = function(extensionID: number, payload: Buffer) {
  const self = this;
  if (extensionID === 0) {
    // Handle the extension handshake:
    self._debug("extension handshake");
    let obj = bencode.decode(payload);
    let m = obj.m;
    if (m["ut_metadata"]) {
      // Handle the ut_metadata protocol here:
      self.ext[UT_METADATA]   = new UTmetadata(obj.metadata_size, self.infoHash);
      self.ext["ut_metadata"] = m["ut_metadata"];

      // Prep emitter responces:
      self.ext[UT_METADATA].on("next", (piece) => {
        // Ask the peer for the next piece
        let request       = { "msg_type": 0, "piece": piece },
            prepRequest   = EXTENDED,
            requestEn     = bencode.encode(request),
            code          = new Buffer(1);
        prepRequest.writeUInt32BE(requestEn.length + 2, 0);
        code.writeUInt8(self.ext["ut_metadata"], 0);
        let requestBuf = Buffer.concat([prepRequest, code, requestEn]);
        this._push(requestBuf);
      });
      self.ext[UT_METADATA].on("metadata", (torrent) => {
        // send up:
        self.emit("metadata", torrent);
      });
    }
    if (m["ut_pex"]) {
      // Handle the PEX protocol here
      self.ext[UT_PEX]   = new UTpex();
      self.ext["ut_pex"] = m["ut_pex"];

      // Prep emitter responces:
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
  } else {
    // Handle the payload with the proper extension
    if (self.meta || extensionID === self.ext["ut_pex"])
      self.ext[extensionID]._message(payload);
  }
};

// All metadata requests:
Hose.prototype.metaDataRequest = function() {
  const self = this;
  if (self.ext["ut_metadata"]) {
    self.metaDataHandshake();
    // Prep and send a meta_data request:
    let request       = { "msg_type": 0, "piece": 0 },
        prepRequest   = EXTENDED,
        requestEn     = bencode.encode(request),
        code          = new Buffer(1);
    prepRequest.writeUInt32BE(requestEn.length + 2, 0);
    code.writeUInt8(self.ext["ut_metadata"], 0);
    let requestBuf = Buffer.concat([prepRequest, code, requestEn]);
    this._push(requestBuf);
  }
};

Hose.prototype.metaDataHandshake = function(msg?) {
  // Prep and send a meta_data handshake:
  this._debug("sending meta_handshake");
  let handshake     = (msg) ? msg : EXT_PROTOCOL,
      prepHandshake = EXTENDED,
      handshakeEn   = bencode.encode(handshake);
  prepHandshake.writeUInt32BE(handshakeEn.length + 2, 0);
  let handshakeBuf  = Buffer.concat([prepHandshake, Buffer.from([0x00]), handshakeEn]);
  this._push(handshakeBuf);
};

/** HANDLE INCOMING MESSAGES HERE: **/

Hose.prototype.handleCode = function(payload: Buffer) {
  const self = this;
  self.nextAction();     // Prep for the next nextAction
  switch (payload[0]) {
    case 0:
      // Choke
      self._debug("got choke");
      self.choked = true;
      self._push(CHOKE);
      break;
    case 1:
      // Unchoke
      self._debug("got unchoke");
      if (self.choked) {
        self.choked = false;
        self._push(UNCHOKE);
      }
      break;
    case 2:
      // Interested
      self._debug("peer is interested");
      self.emit("interested");
      if (self.choked) {
        self.choked = false;
        self._push(Buffer.concat([INTERESTED, UNCHOKE]));
      }
      break;
    case 3:
      // Not Interested
      self._debug("peer is uninterested");
      self.closeConnection();
      break;
    case 4:
      // Have
      self._debug("peer sent have");
      self._onHave(payload.readUInt32BE(1));
      break;
    case 5:
      // Bitfield
      self._debug("Recieved bitfield");
      self._onBitfield(payload.slice(1)); // remove the ID from buffer
      break;
    case 6:
      // Request
      if (self.choked) return;
      self._debug("Recieved request");
      self._onRequest(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.readUInt32BE(9));
      break;
    case 7:
      // Piece
      self._debug("Recieved piece");
      self._onPiece(payload.readUInt32BE(1), payload.readUInt32BE(5), payload.slice(9));
      break;
    case 8:
      // Cancel
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

/** Commands to & from torrentEngine **/

Hose.prototype.isChoked = function(): Boolean {
  return this.choked;
};

Hose.prototype.isBusy = function(): Boolean {
  return this.busy;
};

Hose.prototype.setBusy = function() {
  this.busy = true;
};

Hose.prototype.unsetBusy = function() {
  this.busy = false;
};

Hose.prototype.closeConnection = function() {
  this._debug("CLOSE CONNECTION");
  this.isActive = false;
  this.emit("close");
};

Hose.prototype.removeMeta = function() {
  this.meta = false;
  this.ext[ UT_METADATA ] = null;
  delete this.ext[ UT_METADATA ];
};

Hose.prototype.removePex = function() {
  this.ext[ UT_PEX ] = null;
  delete this.ext[ UT_PEX ];
};

Hose.prototype._debug = function(...args: any[]) {
  args[0] = "[" + this._debugId + "] " + args[0];
  debug.apply(null, args);
};

export default Hose;

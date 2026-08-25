/**
 * The JavaScript injected into every script sandbox before the pack's own code.
 *
 * It defines the entire `table` API in terms of one host call. Keeping the native
 * bridge down to a single string-in/string-out function means the trusted surface a
 * hostile script can attack is one JSON parser, not fifty separate marshalling paths.
 */

export const PRELUDE = `
'use strict';
(function () {
  // Capture the bridge in the closure so it keeps working after the global is removed.
  var host = __host;

  function call(name, args) {
    var raw = host(name, JSON.stringify(args || []));
    var res = JSON.parse(raw);
    if (res.error) throw new Error(res.error);
    return res.value;
  }

  var rejected = null;

  globalThis.table = {
    /* ---- reading the table ---- */
    seats:      function ()        { return call('seats'); },
    players:    function ()        { return call('players'); },
    zones:      function ()        { return call('zones'); },
    piecesIn:   function (zoneId)  { return call('piecesIn', [zoneId]); },
    stacks:     function ()        { return call('stacks'); },
    occupiedSeats: function ()     { return call('seats'); },

    /* ---- table variables, persisted for the life of the room ---- */
    getVar:     function (k)       { return call('getVar', [k]); },
    setVar:     function (k, v)    { return call('setVar', [k, v]); },

    /* ---- acting on the table ---- */
    log:        function (text)    { return call('log', [String(text)]); },
    status:     function (text)    { return call('status', [String(text)]); },
    shuffle:    function (stackId) { return call('shuffle', [stackId || null]); },
    dealTo:     function (seat, n) { return call('dealTo', [seat, n || 1]); },
    dealToZone: function (zone, n) { return call('dealToZone', [zone, n || 1]); },
    burn:       function (stackId) { return call('burn', [stackId || null]); },
    recallAll:  function (stackId) { return call('recallAll', [stackId || null]); },
    moveTo:     function (id, z)   { return call('moveTo', [id, z]); },
    flip:       function (id, up)  { return call('flip', [id, !!up]); },

    /* ---- refusing a move; only meaningful while enforcement is on ---- */
    reject:     function (reason)  { rejected = String(reason || 'Not allowed'); return false; },

    __takeRejection: function () { var r = rejected; rejected = null; return r; },
  };

  // Anything the sandbox does not need is removed rather than left to be discovered.
  delete globalThis.__host;
})();
`;

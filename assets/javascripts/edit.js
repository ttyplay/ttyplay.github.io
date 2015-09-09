document.addEventListener('DOMContentLoaded', function() {
  //
  // Build a DOM Node
  //

  function buildNode(tagName, attributes, children) {
    var node = document.createElement(tagName);

    /* Apply attributes */
    if (attributes) {
      for (var attribute in attributes) {
        if (attributes.hasOwnProperty(attribute)) {
          node[attribute] = attributes[attribute];
        }
      }
    }

    /* Append children */
    if (children) {
      if (typeof children === 'string') {
        node.appendChild(document.createTextNode(children));
      } else if (children.tagName) {
        node.appendChild(children);
      } else if (children.length) {
        for (var i = 0, length = children.length; i < length; ++i) {
          var child = children[i];

          if (typeof child === 'string') {
            child = document.createTextNode(child);
          }

          node.appendChild(child);
        }
      }
    }

    return node;
  }

  //
  // parse a little endian double word from an Uint8Array/ArrayBuffer
  //

  function parseLittleEndianDWORD(array, offset) {
    return array[offset + 3] * 16777216 +
           array[offset + 2] * 65536 +
           array[offset + 1] * 256 +
           array[offset];
  }

  //
  // encode a little endian dword into an array
  //

  function encodeLittleEndianDWORD(array, dword) {
    array.push(dword % 256);
    dword >>= 8;
    array.push(dword % 256);
    dword >>= 8;
    array.push(dword % 256);
    dword >>= 8;
    array.push(dword % 256);
  }

  //
  // read a file and load it as an array buffer
  //

  function read(fileObject, fileName) {
    var reader = new FileReader();

    reader.onerror = function() {
      alert('Error reading file: ' + fileName);
    };
    reader.onloadend = function(event) {
      var array = new Uint8Array(event.target.result);

      if (window.ttyRecord) {
        window.ttyRecord.destroy();
      }

      window.ttyRecord = new TTYRecord('table', array);
    };

    reader.readAsArrayBuffer(fileObject);
  }

  //
  // tty record class
  //

  function TTYRecord(container, array) {
    if (typeof container === 'string') {
      container = document.getElementById(container);
    }

    this.container = container;
    this.parseArray(array);
    this.build();
  }

  //
  // parse a tty record into frames
  //

  TTYRecord.prototype.parseArray = function(array) {
    var offset = 0, length = array.byteLength;
    var prevSec = parseLittleEndianDWORD(array, 0);
    var prevUsec = parseLittleEndianDWORD(array, 4);

    this.startSec = prevSec;
    this.startUsec = prevUsec;
    this.frames = [];

    while (offset < length) {
      var sec = parseLittleEndianDWORD(array, offset);
      var usec = parseLittleEndianDWORD(array, offset + 4);
      var delay = (sec - prevSec) + (usec - prevUsec) * 0.000001;

      prevSec = sec;
      prevUsec = usec;

      var size = parseLittleEndianDWORD(array, offset + 8);
      var subarray = array.subarray(offset + 12, offset + 12 + size);

      this.frames.push({
        sec: sec,
        usec: usec,
        delay: delay,
        data: subarray
      });

      offset += 12 + size;
    }
  };

  //
  // build editor ui
  //

  TTYRecord.prototype.build = function() {
    var _this = this;
    var thead = buildNode('thead', {},
      buildNode('tr', {}, [
        buildNode('th', {}, 'Delay'),
        buildNode('th', {}, 'Data'),
        buildNode('th', {},
          buildNode('a', { href: 'javascript:;', onclick: function(event) { _this.add(event); } }, 'Add')
        )
      ])
    );

    var tbody = buildNode('tbody');
    this.tbody = tbody;

    for (var i = 0, length = this.frames.length; i < length; ++i) {
      var frame = this.frames[i];
      var data = '';

      for (var j = 0; j < frame.data.length; ++j) {
        data += '\\x' + ('00' + frame.data[j].toString(16)).slice(-2);
      }

      var row = buildNode('tr', {}, [
        buildNode('td', {},
          buildNode('input', { type: 'text', value: frame.delay })
        ),
        buildNode('td', {},
          buildNode('input', { type: 'text', value: data, className: 'data' })
        ),
        buildNode('td', {},
          buildNode('a', { href: 'javascript:;', onclick: function(event) { _this.remove(event); } }, 'Remove')
        )
      ]);
      frame.row = row;

      row.dataset.sec = frame.sec;
      row.dataset.usec = frame.usec;

      tbody.appendChild(row);
    }

    this.table = buildNode('table', {}, [
      thead, tbody
    ]);
    this.container.appendChild(this.table);
  };

  //
  // add new frame
  //

  TTYRecord.prototype.add = function(event) {
    var _this = this;
    var row = buildNode('tr', {}, [
      buildNode('td', {},
        buildNode('input', { type: 'text', value: '0.100000' })
      ),
      buildNode('td', {},
        buildNode('input', { type: 'text', value: '', className: 'data' })
      ),
      buildNode('td', {},
        buildNode('a', { href: 'javascript:;', onclick: function(event) { _this.remove(event); } }, 'Remove')
      )
    ]);
    this.tbody.appendChild(row);
  };

  //
  // remove frame
  //

  TTYRecord.prototype.remove = function(event) {
    var anchor = event.target;
    var row = anchor.parentNode.parentNode;
    row.parentNode.removeChild(row);
  };

  //
  // convert ui data to array
  //

  TTYRecord.prototype.toArray = function() {
    var array = [];

    var sec = this.startSec;
    var usec = this.startUsec;

    var rows = this.tbody.getElementsByTagName('tr');

    for (var i = 0, length = rows.length; i < length; ++i) {
      var row = rows[i];
      var inputs = row.getElementsByTagName('input');

      var delay = inputs[0].value;
      var delaySec = parseInt(delay);
      var delayUsec = (delay * 1000000) % 1000000
      sec += delaySec;
      usec += delayUsec;

      while (usec > 1000000) {
        sec += 1;
        usec -= 1000000;
      }

      encodeLittleEndianDWORD(array, sec);
      encodeLittleEndianDWORD(array, usec);

      var data = inputs[1].value;
      var m = data.match(/.{4}/g);
      encodeLittleEndianDWORD(array, m.length);

      for (var j = 0; j < m.length; ++j) {
        array.push(parseInt(m[j].slice(-2), 16));
      }
    }

    return array;
  };

  //
  // save the tty record as a file
  //

  TTYRecord.prototype.save = function() {
    var array = this.toArray();
    array = new Uint8Array(array);
    var blob = new Blob([array], {
      type: 'application/octet-stream; charset=binary'
    });
    saveAs(blob, 'file.ttyrec');
  };

  //
  // destroy editor ui
  //

  TTYRecord.prototype.destroy = function() {
    if (this.table) {
      this.table.parentNode.removeChild(this.table);
    }
  };

  //
  // the world
  //

  var
    openFileTrigger = document.getElementById('open-file-trigger'),
    openFileInput = document.getElementById('open-file'),
    dropContainer = document.getElementById('drop-container');

  //
  // open file click handler
  //

  openFileTrigger.onclick = function() {
    var event = document.createEvent('MouseEvents');
    event.initEvent('click', true, false);
    openFileInput.dispatchEvent(event);
  };

  openFileInput.onchange = function() {
    var fileName = this.value, fileObject = this.files[0];

    if (fileName && fileObject) {
      read(fileObject, fileName);
    }
  };

  //
  // drag & drop support
  //

  dropContainer.ondragenter =
  dropContainer.ondragover =
  function(event) {
    event.dataTransfer.effectAllowed = 'copy';
    dropContainer.className = 'control drag-over';
    return false;
  };

  dropContainer.ondragleave =
  dropContainer.ondragend =
  function(event) {
    dropContainer.className = 'control';
    return false;
  };

  dropContainer.ondrop = function(event) {
    var fileObject = event.dataTransfer.files[0];

    if (fileObject) {
      read(fileObject, fileObject.name);
    }

    return false;
  };
});

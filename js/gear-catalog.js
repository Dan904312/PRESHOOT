/* PreShoot gear suggestion catalog — used by onboarding + searchable gear UI */
(function (global) {
  var CATALOG = {
    camera: [
      'Sony FX3', 'Sony FX6', 'Sony FX30', 'Sony A7IV', 'Sony A7S III', 'Sony A7C II', 'Sony A6700', 'Sony ZV-E1', 'Sony ZV-E10',
      'Canon R5', 'Canon R5 C', 'Canon R6 II', 'Canon R8', 'Canon R50', 'Canon C70', 'Canon EOS R',
      'Blackmagic Pocket 6K', 'Blackmagic Pocket 4K', 'Blackmagic Pyxis', 'BMPCC 6K Pro',
      'Panasonic GH6', 'Panasonic S5 II', 'Panasonic Lumix G9 II',
      'Fujifilm X-H2S', 'Fujifilm X-T5', 'Fujifilm X-S20',
      'Nikon Z8', 'Nikon Z6 III', 'Nikon Zf',
      'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 14 Pro',
      'Google Pixel 9 Pro', 'Samsung Galaxy S25 Ultra', 'GoPro Hero 13', 'Insta360 X4', 'DJI Osmo Pocket 3', 'DJI Osmo Action 5'
    ],
    lens: [
      'Sony 24-70mm f/2.8 GM II', 'Sony 16-35mm f/2.8 GM', 'Sony 70-200mm f/2.8 GM II', 'Sony 35mm f/1.4 GM', 'Sony 50mm f/1.2 GM', 'Sony 85mm f/1.4 GM',
      'Canon RF 24-70mm f/2.8', 'Canon RF 15-35mm f/2.8', 'Canon RF 50mm f/1.2', 'Canon RF 85mm f/1.2',
      'Sigma 24-70mm f/2.8', 'Sigma 18-35mm f/1.8', 'Sigma 35mm f/1.4 Art', 'Sigma 50mm f/1.4 Art', 'Sigma 85mm f/1.4 Art',
      'Tamron 28-75mm f/2.8', 'Tamron 35-150mm f/2-2.8',
      '24-70mm f/2.8', '16-35mm f/2.8', '50mm f/1.8', '35mm f/1.8', '85mm f/1.8', 'Kit lens', 'Phone lens / native'
    ],
    drone: [
      'DJI Air 3', 'DJI Air 3S', 'DJI Mini 4 Pro', 'DJI Mini 3', 'DJI Mini 3 Pro', 'DJI Avata 2', 'DJI Mavic 3 Pro', 'DJI Mavic 3 Classic',
      'DJI Neo', 'Autel EVO Lite+', 'Autel EVO II', 'No drone'
    ],
    microphone: [
      'DJI Mic 2', 'DJI Mic Mini', 'Rode Wireless GO II', 'Rode Wireless PRO', 'Rode VideoMic NTG', 'Rode VideoMic Go II',
      'Shure MV7', 'Shure SM7B', 'Sennheiser MKE 600', 'Sennheiser Profile', 'Hollyland Lark M2', 'Phone mic', 'No external mic'
    ],
    lighting: [
      'Aputure 600d', 'Aputure 300d', 'Aputure Amaran 200x', 'Aputure MC Pro', 'Godox SL60', 'Godox VL150', 'Nanlite Forza 60',
      'Nanlite Pavotube', 'Zhiyun FIVERAY M40', 'Neewer LED Panel', 'Softbox kit', 'Natural light only', 'Ring light'
    ],
    gimbal: [
      'DJI RS 4', 'DJI RS 4 Pro', 'DJI RS 3 Mini', 'DJI RS 3', 'DJI Ronin S', 'Zhiyun Crane 4', 'Zhiyun Weebill 3',
      'Moza AirCross 3', 'Phone gimbal (OM 6)', 'Tripod only', 'Handheld / no gimbal'
    ],
    editingSoftware: [
      'CapCut', 'Premiere Pro', 'Final Cut Pro', 'DaVinci Resolve', 'After Effects', 'iMovie', 'Final Cut', 'Descript', 'VN Editor'
    ]
  };

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function search(category, query, limit) {
    var list = CATALOG[category] || [];
    var q = normalize(query);
    var out = [];
    var i, item, n;
    if (!q) {
      for (i = 0; i < list.length && out.length < (limit || 8); i++) out.push(list[i]);
      return out;
    }
    for (i = 0; i < list.length; i++) {
      item = list[i];
      n = normalize(item);
      if (n.indexOf(q) !== -1) out.push(item);
      if (out.length >= (limit || 10)) break;
    }
    return out;
  }

  function all(category) {
    return (CATALOG[category] || []).slice();
  }

  global.PreShootGearCatalog = {
    CATALOG: CATALOG,
    search: search,
    all: all
  };
})(typeof window !== 'undefined' ? window : globalThis);

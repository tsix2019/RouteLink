'use strict';
'require baseclass';
'require rpc';
'require ui';

/* ubus object "routelink" (API 1) and helpers shared by the RouteLink views. */

var callInfo = rpc.declare({ object: 'routelink', method: 'info' });
var callDevices = rpc.declare({ object: 'routelink', method: 'devices', expect: { devices: [] } });
var callLive = rpc.declare({ object: 'routelink', method: 'live' });
var callHistory = rpc.declare({
	object: 'routelink', method: 'history',
	params: [ 'mac', 'start', 'end', 'class', 'hours', 'max_points' ]
});
var callSummary = rpc.declare({
	object: 'routelink', method: 'summary',
	params: [ 'start', 'end', 'class', 'hours', 'sort', 'limit', 'offset' ]
});
var callEvents = rpc.declare({
	object: 'routelink', method: 'events',
	params: [ 'start', 'end', 'types', 'mac', 'limit', 'offset' ]
});
var callReset = rpc.declare({ object: 'routelink', method: 'reset', params: [ 'scope' ] });
var callCommit = rpc.declare({ object: 'routelink', method: 'commit' });
var callInit = rpc.declare({ object: 'rc', method: 'init', params: [ 'name', 'action' ] });

var SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
	var el = document.createElementNS(SVG, tag);
	for (var k in attrs)
		el.setAttribute(k, attrs[k]);
	return el;
}

function startOfDay(d) {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function secs(d) {
	return Math.floor(d.getTime() / 1000);
}

/* Same presets as the app (src/features/traffic/timeRange.ts), in the browser's time zone. */
var PRESETS = [
	[ 'lastHour', _('Last hour') ],
	[ 'today', _('Today') ],
	[ 'yesterday', _('Yesterday') ],
	[ 'last7d', _('Last 7 days') ],
	[ 'thisMonth', _('This month') ],
	[ 'lastMonth', _('Last month') ],
	[ 'last30d', _('Last 30 days') ]
];

function resolvePreset(id, now) {
	var t = secs(now), today = startOfDay(now);
	switch (id) {
	case 'lastHour':
		return [ t - 3600, t ];
	case 'yesterday':
		return [ secs(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)), secs(today) ];
	case 'last7d':
		return [ t - 7 * 86400, t ];
	case 'thisMonth':
		return [ secs(new Date(now.getFullYear(), now.getMonth(), 1)), t ];
	case 'lastMonth':
		return [ secs(new Date(now.getFullYear(), now.getMonth() - 1, 1)), secs(new Date(now.getFullYear(), now.getMonth(), 1)) ];
	case 'last30d':
		return [ t - 30 * 86400, t ];
	default:
		return [ secs(today), t ];
	}
}

/* 24-bit mask of local hours from..to (exclusive); from > to wraps past midnight. */
function hoursMask(from, to) {
	var mask = 0;
	for (var h = from; h !== to; h = (h + 1) % 24)
		mask |= 1 << h;
	return mask >>> 0;
}

function formatBytes(n) {
	if (n == null)
		return '-';
	var units = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i ? n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) : n) + ' ' + units[i];
}

function formatRate(bytesPerSec) {
	var bits = (bytesPerSec || 0) * 8, units = [ 'bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s' ], i = 0;
	while (bits >= 1000 && i < units.length - 1) {
		bits /= 1000;
		i++;
	}
	return bits.toFixed(i ? 1 : 0) + ' ' + units[i];
}

function formatTime(ts, withDate) {
	var d = new Date(ts * 1000), pad = function(n) { return (n < 10 ? '0' : '') + n; };
	var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
	return withDate === false ? time : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + time;
}

function deviceLabel(d) {
	if (!d)
		return '-';
	if (d.mac === 'unknown')
		return _('Unidentified devices');
	if (d.mac === 'router')
		return _('Router itself');
	return d.name || d.hostname || d.mac;
}

/*
 * Download/upload area chart. points: [ [ts, rx, tx] ] with null for missing data (drawn as a gap).
 * Values are bytes per point; the y axis shows the average rate over the step.
 */
function chart(points, step, height) {
	var width = 800, h = height || 160, pad = 28;
	var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + (h + pad), width: '100%', preserveAspectRatio: 'none',
		style: 'max-height:' + (h + pad) + 'px' });
	var max = 1;
	points.forEach(function(p) {
		if (p[1] != null)
			max = Math.max(max, p[1], p[2]);
	});
	var n = Math.max(points.length, 2);
	var x = function(i) { return i * width / (n - 1); };
	var y = function(v) { return h - v / max * (h - 8); };

	[ [ 1, '#2f7ef6' ], [ 2, '#f39c12' ] ].forEach(function(series) {
		var d = '', open = false, first = 0;
		points.forEach(function(p, i) {
			if (p[series[0]] == null) {
				if (open)
					d += 'L' + x(i - 1) + ',' + h + 'L' + x(first) + ',' + h + 'Z';
				open = false;
				return;
			}
			if (!open) {
				d += 'M' + x(i) + ',' + y(p[series[0]]);
				first = i;
				open = true;
			} else {
				d += 'L' + x(i) + ',' + y(p[series[0]]);
			}
		});
		if (open)
			d += 'L' + x(points.length - 1) + ',' + h + 'L' + x(first) + ',' + h + 'Z';
		root.appendChild(svg('path', { d: d, fill: series[1], 'fill-opacity': '0.25', stroke: series[1], 'stroke-width': '1.5' }));
	});

	points.forEach(function(p, i) {
		if (p[1] == null)
			root.appendChild(svg('rect', { x: x(i) - width / n / 2, y: 0, width: width / n, height: h,
				fill: '#888', 'fill-opacity': '0.12' }));
	});

	var label = svg('text', { x: 4, y: 12, 'font-size': '11', fill: '#888' });
	label.textContent = formatRate(max / (step || 1));
	root.appendChild(label);
	[ 0, Math.floor((points.length - 1) / 2), points.length - 1 ].forEach(function(i, k) {
		if (!points[i])
			return;
		var t = svg('text', { x: x(i), y: h + 18, 'font-size': '11', fill: '#888',
			'text-anchor': k === 0 ? 'start' : k === 1 ? 'middle' : 'end' });
		t.textContent = formatTime(points[i][0], step < 86400 ? (points[points.length - 1][0] - points[0][0] > 86400) : true);
		root.appendChild(t);
	});
	return root;
}

/* Rate sparkline from an array of numbers. */
function sparkline(values, color) {
	var width = 120, h = 24, max = Math.max.apply(null, values.concat([ 1 ]));
	var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + h, width: width, height: h });
	var d = values.map(function(v, i) {
		return (i ? 'L' : 'M') + (i * width / Math.max(values.length - 1, 1)) + ',' + (h - v / max * (h - 2));
	}).join('');
	root.appendChild(svg('path', { d: d, fill: 'none', stroke: color || '#2f7ef6', 'stroke-width': '1.5' }));
	return root;
}

/* Horizontal share bar. */
function bar(value, total, color) {
	var pct = total > 0 ? Math.max(1, Math.round(value / total * 100)) : 0;
	return E('div', { style: 'background:#8882;border-radius:3px;height:6px;min-width:80px' }, [
		E('div', { style: 'width:' + pct + '%;height:6px;border-radius:3px;background:' + (color || '#2f7ef6') })
	]);
}

function csv(rows) {
	var bom = String.fromCharCode(0xfeff); /* Excel only reads UTF-8 with a BOM */
	return bom + rows.map(function(r) {
		return r.map(function(c) {
			c = c == null ? '' : String(c);
			return /[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
		}).join(',');
	}).join('\r\n') + '\r\n';
}

function download(name, text) {
	var a = E('a', { href: URL.createObjectURL(new Blob([ text ], { type: 'text/csv' })), download: name });
	document.body.appendChild(a);
	a.click();
	a.remove();
}

return baseclass.extend({
	info: callInfo,
	devices: callDevices,
	live: callLive,
	history: callHistory,
	summary: callSummary,
	events: callEvents,
	reset: callReset,
	commit: callCommit,
	initAction: callInit,

	PRESETS: PRESETS,
	resolvePreset: resolvePreset,
	hoursMask: hoursMask,
	formatBytes: formatBytes,
	formatRate: formatRate,
	formatTime: formatTime,
	deviceLabel: deviceLabel,
	chart: chart,
	sparkline: sparkline,
	bar: bar,
	csv: csv,
	download: download,

	/* nlbwmon zeroes conntrack counters: offer to stop it. */
	stopNlbwmon: function() {
		return callInit('nlbwmon', 'stop')
			.then(function() { return callInit('nlbwmon', 'disable'); })
			.then(function() { location.reload(); })
			.catch(function(e) { ui.addNotification(null, E('p', {}, e.message), 'error'); });
	},

	/* Warnings shared by the overview and traffic pages. */
	warnings: function(info, onStopNlbwmon) {
		var list = [];
		if (!info.conntrack_accounting)
			list.push(E('p', {}, _('Connection accounting (nf_conntrack_acct) is off: device traffic reads 0.')));
		if (info.offload_warning)
			list.push(E('p', {}, _('Hardware offloading is on: offloaded traffic may not be counted.')));
		if (!info.time_synced)
			list.push(E('p', {}, _('The router clock is not synchronised yet; data is kept in memory until it is.')));
		if (info.nlbwmon_running)
			list.push(E('p', {}, [
				_('nlbwmon is running and resets the connection counters this plugin reads.') + ' ',
				E('button', { 'class': 'btn cbi-button cbi-button-negative', click: onStopNlbwmon }, _('Stop and disable nlbwmon'))
			]));
		return list.length ? E('div', { 'class': 'alert-message warning' }, list) : E([]);
	}
});

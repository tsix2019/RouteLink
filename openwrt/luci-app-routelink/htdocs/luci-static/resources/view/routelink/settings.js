'use strict';
'require view';
'require form';
'require ui';
'require routelink.common as rl';

return view.extend({
	load: function() {
		return L.resolveDefault(rl.info(), null);
	},

	confirmReset: function(scope, title) {
		ui.showModal(title, [
			E('p', {}, _('This cannot be undone.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', click: ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-negative', click: function() {
					return rl.reset(scope).then(function() {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, _('Data cleared.')), 'info');
					});
				} }, _('Clear'))
			])
		]);
	},

	render: function(info) {
		var self = this;
		var m = new form.Map('routelink', _('RouteLink settings'),
			_('Per-device traffic accounting and wireless signal history for the RouteLink app. Changes apply after "Save & Apply".'));

		var s = m.section(form.NamedSection, 'main', 'routelink', _('General'));
		s.addremove = false;

		var o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'traffic', _('Traffic accounting'), _('Only active on a gateway (a zone with masquerading).'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'wifi', _('Wireless sampling'),
			_('Signal, rates and channel busy time of wireless stations. Only active on an access point (a wireless interface in AP mode).'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'data_dir', _('Data directory'),
			_('Kept across firmware upgrades. Moving it starts with empty data: existing files are not copied.'));
		o.default = '/etc/routelink';
		o.rmempty = false;
		/* not the "directory" datatype: it lists the file system, which needs extra rpcd permissions */
		o.validate = function(section_id, value) {
			return /^\/[^\s'"]*$/.test(value) ? true : _('Enter an absolute path such as /mnt/usb/routelink');
		};

		o = s.option(form.Value, 'commit_interval', _('Write to disk every (seconds)'),
			_('0 = automatic: 60 minutes on flash, 10 minutes on disks and USB. Data since the last write is lost on power failure.'));
		o.default = '0';
		o.datatype = 'uinteger';

		o = s.option(form.Value, 'max_size_mb', _('Maximum size (MB)'));
		o.default = '32';
		o.datatype = 'range(1,4096)';

		o = s.option(form.Value, 'max_size_percent', _('Maximum share of free space (%)'));
		o.default = '10';
		o.datatype = 'range(1,90)';

		o = s.option(form.Value, 'sample_interval', _('Sampling interval (seconds)'),
			_('While nobody watches live rates. Totals are exact at any interval.'));
		o.default = '30';
		o.datatype = 'range(5,300)';

		o = s.option(form.Value, 'live_interval', _('Live sampling interval (seconds)'));
		o.default = '2';
		o.datatype = 'range(1,10)';

		s = m.section(form.NamedSection, 'retention', 'retention', _('Retention'));
		s.addremove = false;
		o = s.option(form.Value, 'minute_hours', _('Per-minute data (hours)'));
		o.default = '48';
		o.datatype = 'range(2,336)';
		o = s.option(form.Value, 'hour_days', _('Hourly data (days)'));
		o.default = '90';
		o.datatype = 'range(2,3660)';
		o = s.option(form.Value, 'day_days', _('Daily data (days)'));
		o.default = '730';
		o.datatype = 'range(62,36600)';
		o = s.option(form.Value, 'event_days', _('Events (days)'));
		o.default = '90';
		o.datatype = 'range(1,3660)';
		o = s.option(form.Value, 'signal_minute_days', _('Per-minute signal data (days)'));
		o.default = '7';
		o.datatype = 'range(1,90)';
		o = s.option(form.Value, 'signal_hour_days', _('Hourly signal data (days)'));
		o.default = '30';
		o.datatype = 'range(1,3660)';

		return m.render().then(function(node) {
			var data = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Data')),
				info ? E('p', {}, _('%s used of %s; last written %s.').format(rl.formatBytes(info.storage_used),
					rl.formatBytes(info.storage_limit), info.last_commit ? rl.formatTime(info.last_commit) : _('never'))) : E([]),
				E('div', {}, [
					E('button', { 'class': 'btn cbi-button', click: ui.createHandlerFn(self, function() {
						return rl.commit().then(function(r) {
							ui.addNotification(null, E('p', {}, r.ok ? _('Written to disk.') :
								_('Not written: the router clock is not synchronised yet.')), r.ok ? 'info' : 'warning');
						});
					}) }, _('Write to disk now')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', click: function() { self.confirmReset('traffic', _('Clear traffic data?')); } },
						_('Clear traffic')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', click: function() { self.confirmReset('events', _('Clear events?')); } },
						_('Clear events')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', click: function() { self.confirmReset('signal', _('Clear signal history?')); } },
						_('Clear signal history')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', click: function() { self.confirmReset('all', _('Clear all data?')); } },
						_('Clear everything'))
				])
			]);
			node.appendChild(data);
			return node;
		});
	}
});

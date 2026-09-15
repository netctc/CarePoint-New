part of 'care_provider_schedule.dart';

extension _ProviderForms on _CareProviderScheduleState {
  String details(JourneyMap row) => row.entries.where((e) => e.value is! Map && e.value is! List).map((e) => '${e.key}: ${e.value}').join('\n');
  Future<void> addLocation() async {
    final value = await askJourneyForm(context, widget.locale, t('newLocation'), journeyAddressFields());
    if (value == null || !mounted) return;
    value['countryCode'] = value['countryCode'].toString().toUpperCase();
    await change(t('newLocation'), details(value), () => api.addCareLocation(value));
  }
  Future<void> configureClinic(JourneyMap service) async {
    final available = locations.where((r) => r['active'] == true).toList();
    if (available.isEmpty) { await addLocation(); return; }
    final value = await askJourneyForm(context, widget.locale, t('clinicSettings'), [
      JourneyField('clinicLocationId', 'locations', options: {for (final row in available) row['id'].toString(): row['label'].toString()}),
      const JourneyField('clinicArrivalInstructions', 'instructions', maxLength: 1000),
    ]);
    if (value == null || !mounted) return;
    final name = available.firstWhere((r) => r['id'] == value['clinicLocationId'])['label'];
    await change(t('clinicSettings'), '${service['name']}\n$name\n${value['clinicArrivalInstructions']}', () => api.setCareDelivery(service['id'].toString(), 'CLINIC', value));
  }
  Future<void> configureCoverage(JourneyMap service) async {
    final value = await askJourneyForm(context, widget.locale, t('coverage'), const [
      JourneyField('centerLatitude', 'latitude', kind: JourneyInput.decimal, min: -90, max: 90),
      JourneyField('centerLongitude', 'longitude', kind: JourneyInput.decimal, min: -180, max: 180),
      JourneyField('radiusKm', 'radius', kind: JourneyInput.decimal, min: 0.001, max: 1000),
    ]);
    if (value == null || !mounted) return;
    await change(t('coverage'), '${service['name']}\n${details(value)}', () => api.setCareDelivery(service['id'].toString(), 'HOME_VISIT', {'homeVisitCoverage': value}));
  }
  Future<JourneyMap?> pickService() => showModalBottomSheet<JourneyMap>(context: context, builder: (_) => SafeArea(child: ListView(shrinkWrap: true, children: [
    for (final service in services)
      for (final modality in journeyList(service['modalities']))
        if (hasModality(service, modality['modality'].toString())) ListTile(
          title: Text(service['name'].toString()), subtitle: Text('${t(modality['modality'].toString())} · ${modality['durationMinutes']} min'),
          onTap: () => Navigator.pop(context, {'service': service, 'modality': modality}),
        ),
  ])));
  Future<void> addRule() async {
    final selection = await pickService();
    if (selection == null || !mounted) return;
    final service = journeyMap(selection['service']), mode = journeyMap(selection['modality']);
    final duration = int.tryParse(mode['durationMinutes'].toString()) ?? 30;
    final days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    final value = await askJourneyForm(context, widget.locale, t('newRule'), [
      const JourneyField('timezone', 'timezone', maxLength: 100),
      JourneyField('weekday', 'weekday', initial: '1', options: {for (var i = 0; i < days.length; i++) '$i': t(days[i])}),
      const JourneyField('startTime', 'startTime', kind: JourneyInput.time, initial: '09:00'),
      const JourneyField('endTime', 'endTime', kind: JourneyInput.time, initial: '17:00'),
      JourneyField('effectiveFrom', 'startDate', kind: JourneyInput.date, initial: journeyDate(DateTime.now())),
      const JourneyField('effectiveUntil', 'endDate', kind: JourneyInput.date, required: false),
      JourneyField('intervalMinutes', 'interval', kind: JourneyInput.integer, min: 1, max: 1440, initial: '$duration'),
      const JourneyField('bufferBeforeMinutes', 'before', kind: JourneyInput.integer, min: 0, max: 240, initial: '0'),
      const JourneyField('bufferAfterMinutes', 'after', kind: JourneyInput.integer, min: 0, max: 240, initial: '0'),
      const JourneyField('slotCapacity', 'capacity', kind: JourneyInput.integer, min: 1, max: 100, initial: '1'),
    ], hint: '${service['name']} · ${t(mode['modality'].toString())}\n${t('bufferHint')}', validate: (v) {
      if (parseJourneyMinute(v['endTime'])! <= parseJourneyMinute(v['startTime'])!) return t('invalid');
      if (v['intervalMinutes'] < duration + v['bufferBeforeMinutes'] + v['bufferAfterMinutes']) return t('bufferHint');
      if (v['effectiveUntil'] != null && parseJourneyDate(v['effectiveUntil'])!.isBefore(parseJourneyDate(v['effectiveFrom'])!)) return t('invalid');
      return null;
    });
    if (value == null || !mounted) return;
    final body = <String, dynamic>{...value, 'serviceId': service['id'], 'modality': mode['modality'], 'weekday': int.parse(value['weekday']),
      'startMinute': parseJourneyMinute(value['startTime']), 'endMinute': parseJourneyMinute(value['endTime']),
      'effectiveFrom': journeyIsoDate(parseJourneyDate(value['effectiveFrom'])!),
      if (value['effectiveUntil'] != null) 'effectiveUntil': journeyIsoDate(parseJourneyDate(value['effectiveUntil'])!),
    }..remove('startTime')..remove('endTime');
    await change(t('newRule'), '${service['name']}\n${details(value)}', () => api.addBufferedCareRule(body));
  }
  Future<void> generate() async {
    final value = await askJourneyForm(context, widget.locale, t('generate'), [
      JourneyField('from', 'startDate', kind: JourneyInput.date, initial: journeyDate(DateTime.now())),
      JourneyField('to', 'endDate', kind: JourneyInput.date, initial: journeyDate(DateTime.now().add(const Duration(days: 14)))),
      JourneyField('ruleId', 'rules', required: false, options: {'': t('all'), for (final rule in rules) rule['id'].toString(): '${serviceName(rule)} · ${t(rule['modality'].toString())} · ${rule['weekday']}'}),
    ], validate: validRange);
    if (value == null || !mounted) return;
    await change(t('generate'), details(value), () => api.generateAvailability(fromDate: journeyIsoDate(parseJourneyDate(value['from'])!), toDate: journeyIsoDate(parseJourneyDate(value['to'])!), ruleId: value['ruleId'] as String?));
  }
  String? validRange(JourneyMap value) {
    final a = parseJourneyDate(value['from'])!, b = parseJourneyDate(value['to'])!;
    return b.isBefore(a) || b.difference(a).inDays > 30 ? t('range') : null;
  }
  Future<void> selectRange() async {
    final value = await askJourneyForm(context, widget.locale, t('inventory'), [
      JourneyField('from', 'startDate', kind: JourneyInput.date, initial: journeyDate(from)),
      JourneyField('to', 'endDate', kind: JourneyInput.date, initial: journeyDate(to.subtract(const Duration(days: 1)))),
    ], validate: validRange);
    if (value == null || !mounted) return;
    from = parseJourneyDate(value['from'])!;
    final last = parseJourneyDate(value['to'])!;
    to = DateTime(last.year, last.month, last.day + 1);
    await loadSlots();
  }
  Future<void> addException() async {
    final value = await askJourneyForm(context, widget.locale, t('newException'), [
      JourneyField('kind', 'kind', initial: 'UNAVAILABLE', options: {'UNAVAILABLE': t('UNAVAILABLE'), 'VACATION': t('VACATION')}),
      JourneyField('serviceId', 'serviceFilter', required: false, options: {'': t('all'), for (final row in services) row['id'].toString(): row['name'].toString()}),
      JourneyField('modality', 'modality', required: false, options: {'': t('all'), for (final m in widget.allowedModalities) m: t(m)}),
      JourneyField('from', 'startDate', kind: JourneyInput.date, initial: journeyDate(DateTime.now())),
      JourneyField('to', 'endDate', kind: JourneyInput.date, initial: journeyDate(DateTime.now())),
      const JourneyField('startTime', 'startTime', kind: JourneyInput.time, initial: '09:00'),
      const JourneyField('endTime', 'endTime', kind: JourneyInput.time, initial: '17:00'),
      const JourneyField('reason', 'reason', required: false, maxLength: 500),
    ], hint: t('exceptionHint'), validate: (v) {
      final a = parseJourneyLocalTime(v['from'], v['startTime']), b = parseJourneyLocalTime(v['to'], v['endTime']);
      return a == null || b == null || !b.isAfter(a) || b.difference(a).inDays > 366 ? t('invalid') : null;
    });
    if (value == null || !mounted) return;
    final body = <String, dynamic>{'kind': value['kind'],
      if (value['serviceId'] != null) 'serviceId': value['serviceId'], if (value['modality'] != null) 'modality': value['modality'], if (value['reason'] != null) 'reason': value['reason'],
      'startsAt': parseJourneyLocalTime(value['from'], value['startTime'])!.toUtc().toIso8601String(),
      'endsAt': parseJourneyLocalTime(value['to'], value['endTime'])!.toUtc().toIso8601String(),
    };
    await change(t('newException'), '${details(value)}\n${t('exceptionHint')}', () => api.addCareException(body));
  }
}

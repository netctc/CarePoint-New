import 'dart:convert';
import 'dart:math';

typedef JourneyMap = Map<String, dynamic>;
JourneyMap journeyMap(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<JourneyMap> journeyList(dynamic value) => value is List ? value.map(journeyMap).toList() : <JourneyMap>[];
String journeyDate(DateTime value) => '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year}';
String journeyIsoDate(DateTime value) => '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
String journeyTime(DateTime value) => '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
String journeyDateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  return value == null ? '-' : '${journeyDate(value)} ${journeyTime(value)}';
}

DateTime? parseJourneyDate(String input) {
  final match = RegExp(r'^(\d{2})/(\d{2})/(\d{4})$').firstMatch(input.trim());
  if (match == null) return null;
  final day = int.parse(match[1]!); final month = int.parse(match[2]!); final year = int.parse(match[3]!);
  final value = DateTime(year, month, day);
  return value.day == day && value.month == month && value.year == year ? value : null;
}
int? parseJourneyMinute(String input) {
  final match = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(input.trim());
  if (match == null) return null;
  final hour = int.parse(match[1]!); final minute = int.parse(match[2]!);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}
DateTime? parseJourneyLocalTime(String date, String time) {
  final day = parseJourneyDate(date); final minute = parseJourneyMinute(time);
  if (day == null || minute == null) return null;
  final result = DateTime(day.year, day.month, day.day, minute ~/ 60, minute % 60);
  // Reject local times normalised across a daylight-saving gap.
  return result.hour == minute ~/ 60 && result.minute == minute % 60 ? result : null;
}

String journeyVisitBucket(JourneyMap visit, DateTime now) {
  if (visit['status'] == 'CANCELLED') return 'cancelled';
  final end = DateTime.tryParse((visit['endsAt'] ?? visit['startsAt'])?.toString() ?? '');
  return (visit['status'] == 'REQUESTED' || visit['status'] == 'CONFIRMED') && end != null && end.isAfter(now) ? 'upcoming' : 'history';
}

/// The idempotency key and complete request are fixed at the first confirmation.
/// Callers receive deep copies; form edits can never mutate a pending retry.
/// Kept in memory only: no address/contact data is written to local preferences.
class CareBookingIntent {
  CareBookingIntent({required String slotId, JourneyMap? homeVisit, String? key}) {
    final random = Random.secure();
    idempotencyKey = key ?? 'care-${List.generate(24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
    _encoded = jsonEncode({'slotId': slotId, 'idempotencyKey': idempotencyKey, if (homeVisit != null) 'homeVisit': homeVisit});
  }
  late final String idempotencyKey;
  late final String _encoded;
  JourneyMap get body => Map<String, dynamic>.from(jsonDecode(_encoded) as Map);
  String get slotId => body['slotId'] as String;
}

/// Result ordering guard for rapid filter changes and route disposal.
class JourneyRequestEpoch {
  int _value = 0;
  int begin() => ++_value;
  bool isCurrent(int value) => value == _value;
  void invalidate() { _value++; }
}

JourneyMap journeyClinic(JourneyMap service) {
  for (final item in journeyList(service['deliveryContexts'])) {
    if (item['modality'] == 'CLINIC') return journeyMap(item['clinic']);
  }
  return {};
}
String journeyMoney(dynamic minor, dynamic currency) {
  final value = num.tryParse(minor?.toString() ?? '');
  return value == null ? '-' : '${(value / 100).toStringAsFixed(2)} ${currency ?? ''}';
}

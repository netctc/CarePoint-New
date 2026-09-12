import 'dart:convert';
import 'care_journeys_models.dart';

/// Captured only after explicit confirmation; retries cannot change their body.
class CareRescheduleIntent {
  CareRescheduleIntent({required String slotId, required String expectedUpdatedAt, String? waitlistEntryId, String? key}) {
    if (slotId.isEmpty || DateTime.tryParse(expectedUpdatedAt) == null) throw ArgumentError('A slot and appointment version are required.');
    _encoded = jsonEncode({
      'slotId': slotId,
      'expectedUpdatedAt': expectedUpdatedAt,
      'idempotencyKey': key ?? CareBookingIntent(slotId: slotId).idempotencyKey,
      if (waitlistEntryId != null) 'waitlistEntryId': waitlistEntryId,
    });
  }
  late final String _encoded;
  JourneyMap get body => Map<String, dynamic>.from(jsonDecode(_encoded) as Map);
}

Map<String, String>? planningWindow(String fromText, String toText, {DateTime? before, int maxDays = 31}) {
  final from = parseJourneyDate(fromText), last = parseJourneyDate(toText);
  if (from == null || last == null || last.isBefore(from)) return null;
  var to = DateTime(last.year, last.month, last.day + 1);
  if (before != null && to.isAfter(before)) to = before;
  if (!to.isAfter(from) || to.difference(from) > Duration(days: maxDays)) return null;
  return {'from': from.toUtc().toIso8601String(), 'to': to.toUtc().toIso8601String()};
}

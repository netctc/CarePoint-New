import 'care_journeys_models.dart';

/// Extends the F1 immutable booking body without changing ordinary bookings.
class AvailabilityBookingIntent extends CareBookingIntent {
  AvailabilityBookingIntent({required super.slotId, required this.requestId, super.homeVisit, super.key}) {
    if (requestId.trim().isEmpty) throw ArgumentError('An availability request is required.');
  }
  final String requestId;
  @override
  JourneyMap get body => {...super.body, 'availabilityRequestId': requestId};
}
String availabilityWindowLabel(JourneyMap entry) {
  final from = DateTime.tryParse(entry['fromAt']?.toString() ?? '')?.toLocal();
  final to = DateTime.tryParse(entry['toAt']?.toString() ?? '')?.toLocal().subtract(const Duration(milliseconds: 1));
  return from == null || to == null ? '-' : '${journeyDate(from)} - ${journeyDate(to)}';
}

import 'package:carepoint_mobile_core/secure_share_qr.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('CarePoint fixed QR v10-L encoder produces the verified matrix', () {
    const value = 'https://api.example.test/api/v1/s/AbCdEf0123456789_-AbCdEf0123456789_-AbCdE';
    final matrix = CarePointQrCode.encode(value);
    expect(matrix.length, 57);
    expect(matrix.every((row) => row.length == 57), isTrue);
    final black = matrix.expand((row) => row).where((cell) => cell).length;
    expect(black, 1636);
    expect(
      matrix.first.map((cell) => cell ? '1' : '0').join(),
      '111111100111110011001000110000111100001111000011001111111',
    );
    expect(
      matrix.last.map((cell) => cell ? '1' : '0').join(),
      '111111101011010110101101101010110000111100001110101010111',
    );
  });

  test('CarePoint QR encoder refuses data beyond v10-L byte capacity', () {
    expect(() => CarePointQrCode.encode('x' * 272), throwsArgumentError);
  });
}

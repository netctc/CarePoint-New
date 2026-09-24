import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

class CarePointSecureShareQr extends StatelessWidget {
  const CarePointSecureShareQr({super.key, required this.data, this.dimension = 248});
  final String data;
  final double dimension;

  @override
  Widget build(BuildContext context) {
    try {
      final matrix = CarePointQrCode.encode(data);
      return Semantics(
        label: 'QR code for temporary CarePoint clinical share',
        image: true,
        child: CustomPaint(
          key: const ValueKey('patient-clinical-share-qr'),
          size: Size.square(dimension),
          painter: _CarePointQrPainter(matrix),
        ),
      );
    } on ArgumentError catch (error) {
      return SizedBox(
        width: dimension,
        child: Text(error.message?.toString() ?? 'QR payload is too long.', textAlign: TextAlign.center),
      );
    }
  }
}

class CarePointQrCode {
  static const int version = 10;
  static const int size = 57;
  static const int _dataCodewords = 274;
  static const int _eccPerBlock = 18;
  static const List<int> _blockDataLengths = [68, 68, 69, 69];

  static List<List<bool>> encode(String value) {
    final bytes = utf8.encode(value);
    if (bytes.length > 271) {
      throw ArgumentError.value(bytes.length, 'value', 'UTF-8 QR payload must be at most 271 bytes.');
    }

    final dataBits = <int>[];
    _appendBits(dataBits, 0x4, 4); // byte mode
    _appendBits(dataBits, bytes.length, 16); // version 10 byte-mode length field
    for (final byte in bytes) {
      _appendBits(dataBits, byte, 8);
    }

    final capacityBits = _dataCodewords * 8;
    final terminator = capacityBits - dataBits.length < 4 ? capacityBits - dataBits.length : 4;
    for (var i = 0; i < terminator; i++) {
      dataBits.add(0);
    }
    while (dataBits.length % 8 != 0) {
      dataBits.add(0);
    }

    final data = <int>[];
    for (var offset = 0; offset < dataBits.length; offset += 8) {
      var byte = 0;
      for (var i = 0; i < 8; i++) {
        byte = (byte << 1) | dataBits[offset + i];
      }
      data.add(byte);
    }
    var pad = 0;
    while (data.length < _dataCodewords) {
      data.add(pad.isEven ? 0xEC : 0x11);
      pad++;
    }

    final divisor = _reedSolomonDivisor(_eccPerBlock);
    final blocks = <_QrBlock>[];
    var cursor = 0;
    for (final length in _blockDataLengths) {
      final blockData = data.sublist(cursor, cursor + length);
      cursor += length;
      blocks.add(_QrBlock(blockData, _reedSolomonRemainder(blockData, divisor)));
    }

    final codewords = <int>[];
    final maxDataLength = _blockDataLengths.reduce((left, right) => left > right ? left : right);
    for (var i = 0; i < maxDataLength; i++) {
      for (final block in blocks) {
        if (i < block.data.length) codewords.add(block.data[i]);
      }
    }
    for (var i = 0; i < _eccPerBlock; i++) {
      for (final block in blocks) {
        codewords.add(block.ecc[i]);
      }
    }

    final codeBits = <int>[];
    for (final byte in codewords) {
      _appendBits(codeBits, byte, 8);
    }
    if (codeBits.length != 2768) {
      throw StateError('Unexpected QR version 10-L codeword length.');
    }

    final modules = List.generate(size, (_) => List<bool>.filled(size, false));
    final function = List.generate(size, (_) => List<bool>.filled(size, false));

    void setFunction(int x, int y, bool dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = dark;
      function[y][x] = true;
    }

    for (var i = 0; i < size; i++) {
      setFunction(6, i, i.isEven);
      setFunction(i, 6, i.isEven);
    }

    void finder(int centerX, int centerY) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          final ax = dx.abs();
          final ay = dy.abs();
          final distance = ax > ay ? ax : ay;
          setFunction(centerX + dx, centerY + dy, distance != 2 && distance != 4);
        }
      }
    }

    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    void alignment(int centerX, int centerY) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          final ax = dx.abs();
          final ay = dy.abs();
          final distance = ax > ay ? ax : ay;
          setFunction(centerX + dx, centerY + dy, distance != 1);
        }
      }
    }

    const centers = [6, 28, 50];
    for (var yIndex = 0; yIndex < centers.length; yIndex++) {
      for (var xIndex = 0; xIndex < centers.length; xIndex++) {
        final overlapsFinder =
            (xIndex == 0 && yIndex == 0) ||
            (xIndex == centers.length - 1 && yIndex == 0) ||
            (xIndex == 0 && yIndex == centers.length - 1);
        if (!overlapsFinder) alignment(centers[xIndex], centers[yIndex]);
      }
    }

    final versionBits = _versionBits(version);
    for (var i = 0; i < 18; i++) {
      final dark = ((versionBits >> i) & 1) != 0;
      final a = size - 11 + (i % 3);
      final b = i ~/ 3;
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }

    void drawFormat() {
      final bits = _formatBits(0); // error correction L, mask 0
      bool bit(int i) => ((bits >> i) & 1) != 0;
      for (var i = 0; i < 6; i++) {
        setFunction(8, i, bit(i));
      }
      setFunction(8, 7, bit(6));
      setFunction(8, 8, bit(7));
      setFunction(7, 8, bit(8));
      for (var i = 9; i < 15; i++) {
        setFunction(14 - i, 8, bit(i));
      }
      for (var i = 0; i < 8; i++) {
        setFunction(size - 1 - i, 8, bit(i));
      }
      for (var i = 8; i < 15; i++) {
        setFunction(8, size - 15 + i, bit(i));
      }
      setFunction(8, size - 8, true);
    }

    drawFormat();

    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      final upward = ((right + 1) & 2) == 0;
      for (var vertical = 0; vertical < size; vertical++) {
        final y = upward ? size - 1 - vertical : vertical;
        for (var side = 0; side < 2; side++) {
          final x = right - side;
          if (function[y][x]) continue;
          var dark = codeBits[bitIndex++] != 0;
          if ((x + y).isEven) dark = !dark; // mask 0
          modules[y][x] = dark;
        }
      }
    }
    if (bitIndex != codeBits.length) {
      throw StateError('QR codeword placement did not consume the expected data.');
    }
    drawFormat();
    return modules.map((row) => List<bool>.unmodifiable(row)).toList(growable: false);
  }

  static void _appendBits(List<int> target, int value, int length) {
    for (var i = length - 1; i >= 0; i--) {
      target.add((value >> i) & 1);
    }
  }

  static int _formatBits(int mask) {
    final data = (1 << 3) | mask; // L = 01
    var remainder = data << 10;
    for (var i = 14; i >= 10; i--) {
      if (((remainder >> i) & 1) != 0) {
        remainder ^= 0x537 << (i - 10);
      }
    }
    return ((data << 10) | remainder) ^ 0x5412;
  }

  static int _versionBits(int value) {
    var remainder = value << 12;
    for (var i = 17; i >= 12; i--) {
      if (((remainder >> i) & 1) != 0) {
        remainder ^= 0x1F25 << (i - 12);
      }
    }
    return (value << 12) | remainder;
  }

  static List<int> _reedSolomonDivisor(int degree) {
    final result = List<int>.filled(degree, 0);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = _gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = _gfMultiply(root, 0x02);
    }
    return result;
  }

  static List<int> _reedSolomonRemainder(List<int> data, List<int> divisor) {
    final result = List<int>.filled(divisor.length, 0);
    for (final byte in data) {
      final factor = byte ^ result[0];
      for (var i = 0; i < result.length - 1; i++) {
        result[i] = result[i + 1];
      }
      result[result.length - 1] = 0;
      for (var i = 0; i < result.length; i++) {
        result[i] ^= _gfMultiply(divisor[i], factor);
      }
    }
    return result;
  }

  static int _gfMultiply(int x, int y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ (((z >> 7) & 1) * 0x11D);
      if (((y >> i) & 1) != 0) z ^= x;
    }
    return z;
  }
}

class _QrBlock {
  const _QrBlock(this.data, this.ecc);
  final List<int> data;
  final List<int> ecc;
}

class _CarePointQrPainter extends CustomPainter {
  _CarePointQrPainter(this.matrix);
  final List<List<bool>> matrix;

  @override
  void paint(Canvas canvas, Size size) {
    final extent = size.width < size.height ? size.width : size.height;
    final cell = extent / (matrix.length + 8);
    final qrExtent = cell * matrix.length;
    final left = (size.width - qrExtent) / 2;
    final top = (size.height - qrExtent) / 2;
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    final paint = Paint()..color = Colors.black;
    for (var y = 0; y < matrix.length; y++) {
      for (var x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        canvas.drawRect(
          ui.Rect.fromLTWH(left + x * cell, top + y * cell, cell + 0.05, cell + 0.05),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CarePointQrPainter oldDelegate) => oldDelegate.matrix != matrix;
}

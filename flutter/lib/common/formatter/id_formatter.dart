import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class IDTextEditingController extends TextEditingController {
  IDTextEditingController({String? text}) : super(text: text);

  String get id => trimID(value.text);

  set id(String newID) => text = formatID(newID);
}

class IDTextInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    if (newValue.text.isEmpty) {
      return newValue.copyWith(text: '');
    } else if (newValue.text.compareTo(oldValue.text) == 0) {
      return newValue;
    } else {
      int selectionIndexFromTheRight =
          newValue.text.length - newValue.selection.extentOffset;
      String newID = formatID(newValue.text);
      return TextEditingValue(
        text: newID,
        selection: TextSelection.collapsed(
          offset: newID.length - selectionIndexFromTheRight,
        ),
        // https://github.com/flutter/flutter/issues/78066#issuecomment-797869906
        composing: newValue.composing,
      );
    }
  }
}

String formatID(String id) {
  String id2 = id.replaceAll(' ', '');
  String suffix = '';
  if (id2.endsWith(r'\r') || id2.endsWith(r'/r')) {
    suffix = id2.substring(id2.length - 2, id2.length);
    id2 = id2.substring(0, id2.length - 2);
  }
  // ChainRemote 새 형식: 글자 2 + 숫자 8 ("AB12345678") → "AB 1234 5678" (HQ 등록 시 읽기 편하게).
  //   trimID 가 공백만 제거하므로 접속용 ID 는 그대로 보존. 완성된 ID 만 매칭(타이핑 중 부분입력 제외).
  final ab = RegExp(r'^([A-Za-z]{2})(\d{4})(\d{4})$').firstMatch(id2);
  if (ab != null) {
    // 앞 2글자는 항상 대문자 — 생성 ID 가 대문자이고 서버 매칭이 대소문자 구분이라,
    //   사용자가 소문자로 쳐도(gn…) 접속되게 정규화.
    return '${ab.group(1)!.toUpperCase()} ${ab.group(2)} ${ab.group(3)}$suffix';
  }
  // 기존 숫자 ID(7~9자리 등) — 3자리씩 그룹화(하위호환).
  if (int.tryParse(id2) == null) return id;
  String newID = '';
  if (id2.length <= 3) {
    newID = id2;
  } else {
    var n = id2.length;
    var a = n % 3 != 0 ? n % 3 : 3;
    newID = id2.substring(0, a);
    for (var i = a; i < n; i += 3) {
      newID += " ${id2.substring(i, i + 3)}";
    }
  }
  return newID + suffix;
}

String trimID(String id) {
  final trimmed = id.replaceAll(' ', '');
  // AB 형식(글자2+숫자8)은 접속용으로도 앞 2글자 대문자화 (서버 매칭 대소문자 구분 대비).
  final ab = RegExp(r'^([A-Za-z]{2})(\d{8})$').firstMatch(trimmed);
  if (ab != null) {
    return '${ab.group(1)!.toUpperCase()}${ab.group(2)}';
  }
  return trimmed;
}

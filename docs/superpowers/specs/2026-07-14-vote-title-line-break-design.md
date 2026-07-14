# 투표 화면 제목 줄바꿈 설계

## 목적

투표 링크로 접속했을 때 화면 상단의 큰 제목을 다음과 같이 두 줄로 고정 표시한다.

```text
MX 지원팀
2차 Work-shop 과제 평가
```

브라우저 탭 제목은 기존의 `MX 지원팀 2차 Work-shop 과제 평가` 한 줄을 유지한다.

## 변경 범위

- `public/group1.html`부터 `public/group6.html`까지의 화면 제목
- 공통 투표 문서인 `public/vote.html`의 화면 제목
- 로딩 후 제목을 덮어쓰는 `public/vote.js`의 `renderHeader()`

안내 화면, 관리자 화면, 투표 데이터와 API 처리 로직은 변경하지 않는다.

## 구현 방식

정적 HTML의 `h1#pageTitle`에는 `MX 지원팀` 뒤에 명시적인 `<br>` 요소를 둔다. `vote.js`에서는 제목 전체를 `textContent`로 덮어쓰지 않고 텍스트 노드와 `br` 요소로 같은 구조를 생성한다. 이 방식은 화면 폭과 관계없이 PC와 모바일에서 같은 위치에 줄바꿈을 보장한다.

`<title>` 및 `document.title`에는 줄바꿈을 적용하지 않는다.

## 검증 기준

- 여섯 개 그룹 HTML과 공통 투표 HTML의 `h1#pageTitle` 구조가 동일하다.
- `renderHeader()` 실행 후에도 `MX 지원팀`과 `2차 Work-shop 과제 평가` 사이에 `br` 요소가 존재한다.
- 브라우저 탭 제목은 기존 한 줄 문구와 동일하다.
- `/`, `/admin` 관련 파일과 투표 API 로직에는 변경이 없다.
- 대표 투표 링크를 PC·모바일 크기로 열어 실제 두 줄 표시를 확인한다.

# Cloudflare 무료 배포 가이드

무료로 운영하려면 Render 대신 Cloudflare Pages + D1 조합을 사용합니다.

## 왜 Cloudflare인가

- Pages: 정적 웹페이지 무료 호스팅
- Pages Functions: `/api` 서버 기능
- D1: 투표 결과 저장용 무료 SQLite 데이터베이스

110명 규모의 워크샵 투표에는 무료 한도 안에서 충분합니다.

## 1. Cloudflare 가입

1. https://dash.cloudflare.com 접속
2. 회원가입 또는 로그인
3. 결제카드는 우선 등록하지 않아도 됩니다.

## 2. D1 데이터베이스 만들기

1. 왼쪽 메뉴에서 `Workers & Pages`로 이동
2. `D1 SQL Database` 또는 `D1` 메뉴 선택
3. `Create database` 클릭
4. 이름 입력:

```text
ai-poc-evaluation
```

5. 생성 완료

테이블은 앱이 처음 실행될 때 자동으로 만들어집니다.

## 3. Pages 프로젝트 만들기

1. `Workers & Pages`로 이동
2. `Create application` 클릭
3. `Pages` 선택
4. `Connect to Git` 선택
5. GitHub 저장소 선택:

```text
sungchulsnim/ai-poc-evaluation
```

6. 설정값 입력:

```text
Project name: ai-poc-evaluation
Production branch: main
Framework preset: None
Build command: 비워둠
Build output directory: public
Root directory: /
```

7. `Save and Deploy` 클릭

## 4. D1 바인딩 연결

Pages 프로젝트 생성 후:

1. `Settings` 탭
2. `Functions` 메뉴
3. `D1 database bindings` 찾기
4. `Add binding` 클릭
5. 아래처럼 입력:

```text
Variable name: DB
D1 database: ai-poc-evaluation
```

6. 저장

## 5. 관리자 비밀번호 설정

같은 `Settings` 화면에서 환경변수를 추가합니다.

```text
ADMIN_PASSWORD = 원하는 관리자 비밀번호
SESSION_SECRET = 아무 긴 문자열
```

예:

```text
ADMIN_PASSWORD = SamsungAI2026!
SESSION_SECRET = ai-poc-workshop-session-secret-2026
```

저장 후 `Deployments` 탭에서 최신 배포를 다시 배포합니다.

## 6. 사용할 주소

Cloudflare가 아래와 비슷한 주소를 줍니다.

```text
https://ai-poc-evaluation.pages.dev
```

실제 사용 링크:

```text
관리자: https://ai-poc-evaluation.pages.dev/admin
1그룹: https://ai-poc-evaluation.pages.dev/group1.html
2그룹: https://ai-poc-evaluation.pages.dev/group2.html
3그룹: https://ai-poc-evaluation.pages.dev/group3.html
4그룹: https://ai-poc-evaluation.pages.dev/group4.html
5그룹: https://ai-poc-evaluation.pages.dev/group5.html
```

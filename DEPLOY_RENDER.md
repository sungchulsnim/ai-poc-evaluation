# Render 배포 가이드

이 프로그램은 Render에 바로 올릴 수 있게 준비되어 있습니다.

## 1. GitHub 저장소 준비

현재 폴더의 파일을 새 GitHub 저장소에 올립니다.

반드시 포함할 파일:

```text
server.mjs
config.json
package.json
Dockerfile
render.yaml
public/
```

제외해도 되는 파일:

```text
data/
node_modules/
```

## 2. Render에서 Blueprint 생성

1. Render에 로그인합니다.
2. `New` 메뉴에서 `Blueprint`를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. 루트의 `render.yaml`을 인식하면 그대로 생성합니다.
5. `ADMIN_PASSWORD` 값을 입력합니다.

배포가 끝나면 Render가 아래와 같은 공개 주소를 만들어줍니다.

```text
https://ai-poc-evaluation.onrender.com
```

## 3. 사용할 링크

실제 생성된 Render 주소가 `https://example.onrender.com`이라면 아래처럼 사용합니다.

```text
관리자 대시보드: https://example.onrender.com/admin

1그룹: https://example.onrender.com/group1.html
2그룹: https://example.onrender.com/group2.html
3그룹: https://example.onrender.com/group3.html
4그룹: https://example.onrender.com/group4.html
5그룹: https://example.onrender.com/group5.html
```

## 4. 데이터 저장

`render.yaml`은 `/data`에 persistent disk를 붙이도록 설정되어 있습니다.

투표 결과는 아래 파일에 저장됩니다.

```text
/data/votes.json
```

관리자 대시보드에서는 과제별 평균 점수와 CSV 다운로드를 사용할 수 있습니다.

## 5. 배포 후 확인

아래 주소가 정상 응답하면 서버가 살아 있는 상태입니다.

```text
https://example.onrender.com/api/health
```

관리자 대시보드는 `ADMIN_PASSWORD`로 로그인해야 볼 수 있습니다.

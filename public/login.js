const form = document.querySelector("#loginForm");
const message = document.querySelector("#loginMessage");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "확인 중";

  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      password: form.password.value
    })
  });
  const data = await response.json();

  if (data.ok) {
    location.href = "/admin";
    return;
  }

  message.textContent = data.message || "로그인하지 못했습니다.";
  button.disabled = false;
  button.textContent = "로그인";
});

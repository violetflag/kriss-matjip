// KRISS 맛집로드 설정
window.APP_CONFIG = {
  KAKAO_JS_KEY: "30be3c295037e8cd84de3003948eb140",
  SUPABASE_URL: "https://gtvxwfkhmpjabxshltlu.supabase.co",
  SUPABASE_ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0dnh3ZmtobXBqYWJ4c2hsdGx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyOTM5MDUsImV4cCI6MjEwNjg2OTkwNX0.6zymACeAD773-8rSC1vTIhga1dDNV-npFuYQxV74MJI",
  // 접속 비밀번호 SHA-256 (Supabase settings 테이블에 값이 없을 때만 사용). 기본값: "$kriss"
  DEFAULT_GATE_HASH: "c9f5ff0e089f2e2531e075617c2acd2470a3acc43aebc4d95373072f06523ac9",
  EMAIL_DOMAIN: "kriss-matjip.local",   // 아이디 → 가짜 이메일 변환용
  ADMIN_ID: "admin"
};

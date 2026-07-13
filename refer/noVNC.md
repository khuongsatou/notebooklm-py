
Trong dự án này, phần “giả lập Linux” thực chất là **Docker container chạy Debian**, không thấy dùng QEMU/WSL/proot riêng.

Cụ thể:

- Open source gốc: `open-source/recorder`, remote là `https://github.com/OmGuptaIND/recorder.git`
- Base Linux image: `debian:bullseye` ở [Dockerfile](/Users/apple/Desktop/ex_project_14/mtips5s_vidtools/open-source/recorder/Dockerfile:1)
- Chạy bằng Docker Compose: service `recorder` dùng image `recorder-dev` ở [docker-compose.yml](/Users/apple/Desktop/ex_project_14/mtips5s_vidtools/open-source/recorder/docker-compose.yml:1)
- README ghi rõ yêu cầu là `docker` và workflow dùng `docker build` / `docker-compose up` ở [readme.md](/Users/apple/Desktop/ex_project_14/mtips5s_vidtools/open-source/recorder/readme.md:5)

Các thành phần “môi trường Linux ảo” bên trong container:

- `Xvfb`: tạo màn hình ảo
- `PulseAudio`: tạo audio device ảo
- `ffmpeg`: record màn hình/audio
- `Chromium + chromedriver`: browser chạy trong container
- `x11vnc + noVNC + websockify`: xem/điều khiển browser qua VNC web

Nói ngắn gọn: **dự án dùng Docker + Debian Bullseye container**, còn “màn hình Linux ảo” là **Xvfb**, không phải một trình giả lập Linux riêng.

# Pinned, upstream open-source speed-testing CLI; build for amd64 and arm64.
FROM golang:1.26-alpine AS speedtest-builder
RUN apk add --no-cache ca-certificates git
ENV CGO_ENABLED=0
RUN go install github.com/showwin/speedtest-go@v1.8.3

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8765 \
    DATA_DIR=/data \
    TZ=Europe/London
WORKDIR /opt/monitor
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    groupadd -g 10001 app && useradd -u 10001 -g app -M -s /usr/sbin/nologin app && \
    mkdir -p /data && chown app:app /data
COPY --from=speedtest-builder /go/bin/speedtest-go /usr/local/bin/speedtest-go
COPY app/ ./app/
COPY entrypoint.py ./entrypoint.py
VOLUME ["/data"]
EXPOSE 8765
HEALTHCHECK --interval=40s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health',timeout=3).read()" || exit 1
ENTRYPOINT ["python", "/opt/monitor/entrypoint.py"]
CMD ["waitress-serve", "--host=0.0.0.0", "--port=8765", "--threads=6", "app.app:app"]

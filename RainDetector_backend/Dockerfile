FROM php:8.3-cli
WORKDIR /app
COPY . /app
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8000} server.php"]

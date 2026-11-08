<<<<<<< HEAD
FROM php:8.3-cli
WORKDIR /app
COPY . /app
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8000} server.php"]
=======
FROM php:8.2-cli

WORKDIR /app

# Copy all backend files
COPY . .

# Expose the port Railway provides via $PORT env var
EXPOSE 8080

# Start the PHP built-in server on the dynamic PORT
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8080} server.php"]
>>>>>>> 9332f7e (Remove history table, simulate button, and backend banner)

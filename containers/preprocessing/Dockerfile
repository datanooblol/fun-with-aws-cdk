FROM python:3.12-slim

WORKDIR /app

RUN pip install boto3 uv

COPY main.py .

CMD ["python", "main.py"]
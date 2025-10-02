import boto3
import subprocess
import tarfile
from pathlib import Path

def list_bucket():
    s3_client = boto3.client("s3")
    response = s3_client.list_buckets()
    print(f"Found {len(response['Buckets'])} buckets")
    print(response["Buckets"])

def load_params():
    return dict(
        input_bucket="test-container-development",
        pyproject="artifacts/pyproject.toml",
        data="input/data.csv",
        script="artifacts/script.py",
        package="artifacts/package.tar.gz",
        output_bucket="test-container-development",
    )

def upload_output_files(params):
    """Upload all files in output/ directory to S3"""
    s3_client = boto3.client("s3")
    output_dir = Path.cwd() / "output"
    
    if output_dir.exists():
        for file_path in output_dir.rglob("*"):
            if file_path.is_file():
                # Create S3 key by removing /output/ prefix
                s3_key = file_path.relative_to(output_dir)
                s3_client.upload_file(str(file_path), params["output_bucket"], f"output/{s3_key}")
                print(f"Uploaded {file_path} to s3://{params['output_bucket']}/output/{s3_key}")

def initialize(params):
    # Create input folder
    input_dir = Path.cwd() / "input"
    input_dir.mkdir(exist_ok=True)
    output_dir = Path.cwd() / "output"
    output_dir.mkdir(exist_ok=True)
    
    s3_client = boto3.client("s3")
    s3_client.download_file(params["input_bucket"], params["pyproject"], "pyproject.toml")
    s3_client.download_file(params["input_bucket"], params["data"], str(input_dir / "data.csv"))
    s3_client.download_file(params["input_bucket"], params["script"], "script.py")
    s3_client.download_file(params["input_bucket"], params["package"], "package.tar.gz")
    with tarfile.open("package.tar.gz", 'r:gz') as tar:
        tar.extractall()

if __name__=='__main__':
    params = load_params()
    initialize(params)
    subprocess.run(["uv", "sync"])
    subprocess.run(["uv", "run", "script.py"])
    # Upload all files in /out/ to S3
    upload_output_files(params)
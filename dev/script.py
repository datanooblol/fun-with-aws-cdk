from package.hello_world import hello_world
import pandas as pd

def process():
    df = pd.read_csv("./input/data.csv")
    df.head(5).to_csv("./output/result.csv", index=False)

def main():
    print(hello_world())
    process()


if __name__ == "__main__":
    main()

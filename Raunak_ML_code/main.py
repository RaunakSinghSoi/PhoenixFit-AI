# Author: Raunak Singh Soi
# PhoenixFit – Main Launcher

from squat import run_squat
from pushup import run_pushup
from deadlift import run_deadlift
from utils.classifier import predict_exercise
import sys

def main():
    print("\nPhoenixFit AI — Exercise Analyzer")
    print("====================================")
    print("0. Auto Detect Exercise")
    print("1. Squat")
    print("2. Push-Up")
    print("3. Deadlift")
    print("====================================")
    
    if len(sys.argv) > 1:
        choice = sys.argv[1]
        print(f"Auto-selecting choice: {choice}")
    else:
        choice = input("Select (0, 1, 2, 3): ")

    if choice == "1" or choice.lower() == "squat":
        print("Launching: Squat Module\n")
        run_squat()
        return
    
    if choice == "2" or choice.lower() == "pushup":
        print("Launching: Push-Up Module\n")
        run_pushup()
        return
    
    if choice == "3" or choice.lower() == "deadlift":
        print("Launching: Deadlift Module\n")
        run_deadlift()
        return

    print("Invalid choice.")

if __name__ == "__main__":
    main()

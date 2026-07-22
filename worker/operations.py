"""Text processing operations supported by the worker."""


def run_operation(operation: str, text: str) -> str:
    if operation == "UPPERCASE":
        return text.upper()
    if operation == "LOWERCASE":
        return text.lower()
    if operation == "REVERSE":
        return text[::-1]
    if operation == "WORD_COUNT":
        return str(len(text.split()))
    raise ValueError(f"Unsupported operation: {operation}")

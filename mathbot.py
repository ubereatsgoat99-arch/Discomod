import os
import certifi
import discord
from discord import app_commands
from discord.ext import commands
import subprocess
import requests
import sympy
import sys
import asyncio
from collections import defaultdict

# --- ENV SETUP ---
os.environ['SSL_CERT_FILE'] = certifi.where()
sys.set_int_max_str_digits(0)

# --- CONFIG ---
TOKEN = "YOUR_TOKEN_HERE"
WOLFRAM_APPID = "6JP9U2AAW4"
QALCULATE_PATH = "/opt/homebrew/bin/qalc"

# --- INTENTS / BOT SETUP ---
intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents)
tree = bot.tree

user_inputs = defaultdict(list)       # For legacy .Calc / .qalc message commands
multi_line_inputs = defaultdict(list)  # For slash commands


# ─────────────────────────────────────────────
#  HELPER FUNCTIONS
# ─────────────────────────────────────────────

async def send_long_message(interaction, result):
    """Send a potentially very long result in chunked code blocks via followup."""
    try:
        if not result:
            result = "(No output)"
        wrap_start = "```\n"
        wrap_end = "\n```"
        max_chunk = 2000 - len(wrap_start) - len(wrap_end)
        chunks = [result[i:i + max_chunk] for i in range(0, len(result), max_chunk)]
        for chunk in chunks:
            await interaction.followup.send(f"{wrap_start}{chunk}{wrap_end}")
    except Exception as e:
        await interaction.followup.send("❌ Output too long or failed.")


def sympy_eval(expression: str) -> str:
    try:
        expr = sympy.sympify(expression)
        result = sympy.simplify(expr)
        return str(result)
    except Exception as e:
        return f"SymPy Error: {e}"


def qalc(expression: str) -> str:
    try:
        result = subprocess.run(
            [QALCULATE_PATH, "-e", expression],
            capture_output=True,
            text=True
        )
        return result.stdout.strip()
    except Exception as e:
        return f"Error running qalc: {e}"


def superqalc_onefile(expression: str) -> str:
    try:
        proc = subprocess.run(
            ["./superqalc_onefile", expression],
            capture_output=True,
            text=True
        )
        return proc.stdout.strip() if proc.returncode == 0 else "Error running superqalc_onefile."
    except Exception as e:
        return f"Error: {e}"


def superqalc_tower(expression: str) -> str:
    try:
        proc = subprocess.run(
            ["./superqalc_tower"],
            input=expression.encode(),
            capture_output=True
        )
        return proc.stdout.decode().strip() if proc.returncode == 0 else "Error running superqalc_tower."
    except Exception as e:
        return f"Error: {e}"


def wolfram_query(expression: str) -> str:
    try:
        url = "http://api.wolframalpha.com/v2/query"
        params = {"input": expression, "appid": WOLFRAM_APPID, "output": "JSON"}
        response = requests.get(url, params=params)
        data = response.json()
        pods = data.get("queryresult", {}).get("pods", [])
        for pod in pods:
            if pod["title"].lower() in ["result", "solution", "exact result", "definite integral"]:
                return pod["subpods"][0]["plaintext"]
        if pods:
            return pods[0]["subpods"][0]["plaintext"]
        return "No answer found."
    except Exception as e:
        return f"Error contacting Wolfram Alpha: {e}"


# ─────────────────────────────────────────────
#  MATH SLASH COMMANDS  (with multi-line support)
# ─────────────────────────────────────────────

@tree.command(name="calc", description="Qalculate CLI calculation")
@app_commands.describe(expression="Expression or 'Evaluate' for multi-line input")
async def calc(interaction: discord.Interaction, expression: str):
    await interaction.response.defer(ephemeral=False)
    uid = interaction.user.id
    if expression.lower() == "evaluate" and uid in multi_line_inputs:
        expr = "".join(multi_line_inputs[uid])
        del multi_line_inputs[uid]
        await send_long_message(interaction, qalc(expr))
    else:
        multi_line_inputs[uid].append(expression)
        await interaction.followup.send("🧮 Multi-line Qalculate mode started. Send more lines or type `Evaluate`")


@tree.command(name="wolf", description="Ask Wolfram Alpha")
@app_commands.describe(question="Question or 'Evaluate' for multi-line input")
async def wolf(interaction: discord.Interaction, question: str):
    await interaction.response.defer(ephemeral=False)
    uid = interaction.user.id
    if question.lower() == "evaluate" and uid in multi_line_inputs:
        expr = "".join(multi_line_inputs[uid])
        del multi_line_inputs[uid]
        await send_long_message(interaction, wolfram_query(expr))
    else:
        multi_line_inputs[uid].append(question)
        await interaction.followup.send("🧮 Multi-line Wolfram mode started. Send more lines or type `Evaluate`")


@tree.command(name="supercalc", description="Run superqalc_onefile")
@app_commands.describe(expression="Expression or 'Evaluate' for multi-line input")
async def supercalc(interaction: discord.Interaction, expression: str):
    await interaction.response.defer(ephemeral=False)
    uid = interaction.user.id
    if expression.lower() == "evaluate" and uid in multi_line_inputs:
        expr = "".join(multi_line_inputs[uid])
        del multi_line_inputs[uid]
        await send_long_message(interaction, superqalc_onefile(expr))
    else:
        multi_line_inputs[uid].append(expression)
        await interaction.followup.send("🧮 Multi-line superqalc mode started. Send more lines or type `Evaluate`")


@tree.command(name="supertower", description="Run superqalc_tower")
@app_commands.describe(expression="Expression or 'Evaluate' for multi-line input")
async def supertower(interaction: discord.Interaction, expression: str):
    await interaction.response.defer(ephemeral=False)
    uid = interaction.user.id
    if expression.lower() == "evaluate" and uid in multi_line_inputs:
        expr = "".join(multi_line_inputs[uid])
        del multi_line_inputs[uid]
        await send_long_message(interaction, superqalc_tower(expr))
    else:
        multi_line_inputs[uid].append(expression)
        await interaction.followup.send("🧮 Multi-line superqalc_tower mode started. Send more lines or type `Evaluate`")


@tree.command(name="sympy", description="Evaluate using SymPy")
@app_commands.describe(expression="Expression or 'Evaluate' for multi-line input")
async def sympy_command(interaction: discord.Interaction, expression: str):
    await interaction.response.defer(ephemeral=False)
    uid = interaction.user.id
    if expression.lower() == "evaluate" and uid in multi_line_inputs:
        expr = "".join(multi_line_inputs[uid])
        del multi_line_inputs[uid]
        await send_long_message(interaction, sympy_eval(expr))
    else:
        multi_line_inputs[uid].append(expression)
        await interaction.followup.send("🧮 Multi-line SymPy mode started. Send more lines or type `Evaluate`")


# ─────────────────────────────────────────────
#  ON_MESSAGE  — .Calc / .qalc + Evaluate handler
# ─────────────────────────────────────────────

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    uid = message.author.id
    content = message.content.strip()

    # Start multi-line .Calc session
    if content.startswith(".Calc "):
        user_inputs[uid] = [content[6:]]
        await message.channel.send("📝 Send more lines or type `Evaluate`")
        return

    # Start multi-line .qalc session
    if content.startswith(".qalc "):
        user_inputs[uid] = [content[6:]]
        await message.channel.send("🧮 Qalculate mode started. Send more lines or type `Evaluate`")
        return

    # Evaluate accumulated lines
    if uid in user_inputs:
        if content.lower() == "evaluate":
            expr = "".join(user_inputs[uid])
            del user_inputs[uid]

            if expr.lower().startswith("sympy"):
                expr_to_eval = expr[len("sympy"):].strip()
                try:
                    result = str(sympy.sympify(expr_to_eval))
                except Exception as e:
                    result = f"SymPy Error: {e}"
            elif expr.lower().startswith("tower"):
                to_eval = expr[len("tower"):].strip()
                result = superqalc_tower(to_eval)
            elif expr.lower().startswith("qalc"):
                to_eval = expr[len("qalc"):].strip()
                result = qalc(to_eval)
            else:
                result = superqalc_onefile(expr)

            wrap_start = "```\n"
            wrap_end = "\n```"
            max_chunk = 2000 - len(wrap_start) - len(wrap_end)
            for i in range(0, len(result), max_chunk):
                await message.channel.send(f"{wrap_start}{result[i:i+max_chunk]}{wrap_end}")
        else:
            user_inputs[uid].append(content)
        return

    await bot.process_commands(message)


# ─────────────────────────────────────────────
#  READY & SYNC
# ─────────────────────────────────────────────

@bot.event
async def on_ready():
    synced = await tree.sync()
    print(f"✅ Logged in as {bot.user} (ID: {bot.user.id})")
    print(f"✅ Synced {len(synced)} global slash commands!")


@bot.event
async def on_command_error(ctx, error):
    await ctx.send(f"❌ Error: {error}")


# --- RUN BOT ---
bot.run(TOKEN)
